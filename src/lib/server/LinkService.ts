// FILE: src/lib/server/LinkService.ts
import { Data, Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../types";
import type { UserId } from "../../types/generated/central/public/User";
import type { NoteId, BlockId } from "../shared/schemas"; // ✅ Added BlockId import
import type { NewLink } from "#src/types/generated/tenant/tenant_template/Link";

const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

export class LinkServiceError extends Data.TaggedError("LinkServiceError")<{
  readonly cause: unknown;
}> {}

export const updateLinksForNote = (
  db: Kysely<Database> | Transaction<Database>, 
  noteId: NoteId, 
  _userId: UserId 
) =>
  Effect.gen(function* () {
    // 1. Fetch current blocks to parse for *Intended* links
    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .select(["id", "content"])
          .where("note_id", "=", noteId)
          .execute(),
      catch: (cause) => new LinkServiceError({ cause }),
    });

    // 2. Extract potential targets from content
    const potentialTitles = new Set<string>();
    const blockLinkMap = new Map<string, Set<string>>(); // blockId -> Set<targetTitle>

    for (const block of blocks) {
      const matches = [...block.content.matchAll(WIKI_LINK_REGEX)];
      if (matches.length > 0) {
        const titles = new Set<string>();
        for (const match of matches) {
          if (match[1]) {
            potentialTitles.add(match[1]);
            titles.add(match[1]);
          }
        }
        blockLinkMap.set(block.id, titles);
      }
    }

    // 3. Resolve Titles to Note IDs (Optimized by Index)
    const titleToIdMap = new Map<string, string>();
    
    if (potentialTitles.size > 0) {
      const resolvedNotes = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .select(["id", "title"])
            .where("title", "in", Array.from(potentialTitles))
            .execute(),
        catch: (cause) => new LinkServiceError({ cause }),
      });
      
      for (const n of resolvedNotes) {
        titleToIdMap.set(n.title, n.id);
      }
    }

    // 4. Calculate Desired Links
    // Structure: `${source_block_id}:${target_note_id}` for easy set comparison
    const desiredLinkSignatures = new Set<string>();
    const desiredLinks: NewLink[] = [];

    for (const [blockId, titles] of blockLinkMap) {
      for (const title of titles) {
        const targetId = titleToIdMap.get(title);
        if (targetId) {
          desiredLinkSignatures.add(`${blockId}:${targetId}`);
          // ✅ FIX: Cast strings to Branded Types for insert
          desiredLinks.push({ 
              source_block_id: blockId as BlockId, 
              target_note_id: targetId as NoteId 
          });
        }
      }
    }

    // 5. Fetch Existing Links for this Note's blocks
    // We only need to fetch links originating from blocks belonging to this note
    const existingLinksRaw = yield* Effect.tryPromise({
      try: () => 
        db.selectFrom("link")
          .innerJoin("block", "block.id", "link.source_block_id")
          .select(["link.source_block_id", "link.target_note_id"])
          .where("block.note_id", "=", noteId)
          .execute(),
      catch: (cause) => new LinkServiceError({ cause }),
    });

    const existingLinkSignatures = new Set(
        existingLinksRaw.map(l => `${l.source_block_id}:${l.target_note_id}`)
    );

    // 6. Calculate Delta
    const toInsert = desiredLinks.filter(l => !existingLinkSignatures.has(`${l.source_block_id}:${l.target_note_id}`));
    const toRemoveSignatures = [...existingLinkSignatures].filter(s => !desiredLinkSignatures.has(s));

    // 7. Execute Delta (Concurrent)
    const effects = [];

    if (toInsert.length > 0) {
        effects.push(Effect.tryPromise({
            try: () => db.insertInto("link").values(toInsert).execute(),
            catch: (cause) => new LinkServiceError({ cause })
        }));
    }

    if (toRemoveSignatures.length > 0) {
        const tuples = toRemoveSignatures.map(s => {
            const [src, tgt] = s.split(":");
            return [src, tgt];
        });

        if (tuples.length > 0) {
             effects.push(Effect.tryPromise({
                try: () => {
                    const q = db.deleteFrom("link");
                   
                   // For strict correctness without raw SQL complexity in this snippet, 
                   // we perform one delete query using 'or' conditions.
                   return q.where((eb) => {
                       return eb.or(
                           tuples.map(([src, tgt]) => {
                               // ✅ FIX: Handle undefined from split/destructure and cast to Branded Types
                               const safeSrc = (src || "") as BlockId;
                               const safeTgt = (tgt || "") as NoteId;
                               
                               return eb.and([
                                   eb("source_block_id", "=", safeSrc),
                                   eb("target_note_id", "=", safeTgt)
                               ]);
                           })
                       );
                   }).execute();
                },
                catch: (cause) => new LinkServiceError({ cause })
            }));
        }
    }

    if (effects.length > 0) {
        yield* Effect.all(effects, { concurrency: "unbounded" });
        yield* Effect.logInfo(`[LinkService] Delta Sync: +${toInsert.length} / -${toRemoveSignatures.length} links.`);
    } else {
        yield* Effect.logDebug("[LinkService] No link changes detected.");
    }
  });
