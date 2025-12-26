// FILE: src/lib/shared/permissions.ts

    export const ROLES = {
      OWNER: "OWNER",
      ADMIN: "ADMIN",
      MEMBER: "MEMBER",
      GUEST: "GUEST",
    } as const;

    export type Role = keyof typeof ROLES;

    export const PERMISSIONS = {
      // Note Operations
      NOTE_CREATE: "note:create",
      NOTE_EDIT: "note:edit",
      NOTE_DELETE: "note:delete",

      // Block/Task Operations
      BLOCK_EDIT: "block:edit", // Writing text, changing content
      TASK_UPDATE: "task:update", // Ticking checkboxes

      // Notebooks
      NOTEBOOK_CREATE: "notebook:create",
      NOTEBOOK_DELETE: "notebook:delete",

      // User Management
      USER_INVITE: "user:invite",
    } as const;

    export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

    /**
     * The Source of Truth for RBAC.
     * Defines exactly what each role can do.
     */
    export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
      OWNER: Object.values(PERMISSIONS), // Superuser in tenant context

      ADMIN: [
        PERMISSIONS.NOTE_CREATE,
        PERMISSIONS.NOTE_EDIT,
        PERMISSIONS.NOTE_DELETE,
        PERMISSIONS.BLOCK_EDIT,
        PERMISSIONS.TASK_UPDATE,
        PERMISSIONS.NOTEBOOK_CREATE,
        PERMISSIONS.NOTEBOOK_DELETE,
        PERMISSIONS.USER_INVITE,
      ],

      MEMBER: [
        PERMISSIONS.NOTE_CREATE,
        PERMISSIONS.NOTE_EDIT,
        PERMISSIONS.BLOCK_EDIT,
        PERMISSIONS.TASK_UPDATE,
        PERMISSIONS.NOTEBOOK_CREATE,
        // CANNOT DELETE NOTES
        // CANNOT INVITE USERS
      ],

      GUEST: [
        PERMISSIONS.TASK_UPDATE, // Can only tick boxes (compliance checks)
        // CANNOT EDIT TEXT BLOCKS
        // CANNOT CREATE NOTES
      ]
    };

    export const hasPermission = (role: string | null | undefined, permission: Permission): boolean => {
      if (!role) return false;
      // Safe cast for runtime check
      const perms = ROLE_PERMISSIONS[role as Role];
      return perms ? perms.includes(permission) : false;
    };
