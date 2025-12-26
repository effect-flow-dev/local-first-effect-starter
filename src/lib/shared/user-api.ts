// src/lib/shared/user-api.ts
import { Schema } from "effect";

export const UserApi = {
  uploadAvatarResponseSchema: Schema.Struct({
    avatarUrl: Schema.String,
  }),
};
