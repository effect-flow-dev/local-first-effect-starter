// FILE: src/lib/client/i18n/en.ts
export const en = {
  common: {
    loading: "Loading...",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    logout: "Logout",
    profile: "Profile",
    notes: "Notes",
    language: "Language",
    private: "Private",
    untitled_note: "Untitled Note",
    back_to_login: "Back to Login",
    success: "Success!",
    error: "Error",
  },
  auth: {
    login_title: "Login",
    signup_title: "Create an Account",
    email_label: "Email",
    password_label: "Password",
    confirm_password_label: "Confirm Password",
    old_password_label: "Old Password",
    new_password_label: "New Password",
    forgot_password: "Forgot your password?",
    no_account: "Don't have an account? Sign up.",
    has_account: "Already have an account? Log in.",
    login_button: "Login",
    logging_in: "Logging in...",
    create_account_button: "Create Account",
    creating_account: "Creating...",
    save_password: "Save Password",
    saving: "Saving...",
    passwords_do_not_match: "Passwords do not match.",
    tenant_strategy_label: "Isolation Strategy",
    strategy_schema: "Schema (Shared DB)",
    strategy_database: "Database (Dedicated)",
    subdomain_label: "Workspace URL (Subdomain)",
    subdomain_placeholder: "e.g. app",
  },
  profile: {
    title: "Your Profile",
    change_picture: "Change Picture",
    change_password: "Change Password",
    password_changed: "Password changed successfully!",
    avatar_updated: "Avatar updated!",
  },
  notes: {
    title: "Your Notes",
    subtitle: "Create, view, and edit your notes below.",
    create_new: "Create New Note",
    creating: "Creating...",
    loading: "Loading notes...",
    empty_title: "No notes yet",
    empty_desc: "Click \"Create New Note\" to get started.",
    delete_confirm_title: "Delete Note",
    delete_confirm_desc: "Are you sure you want to delete this note? This action cannot be undone.",
    no_content: "No additional content",
    // ✅ NEW: Bulk Actions
    bulk_delete: "Delete ({count})",
    bulk_delete_confirm_title: "Delete {count} Notes",
    bulk_delete_confirm_desc: "Are you sure you want to delete these {count} notes? This action cannot be undone.",
    select_all: "Select All",
    deselect_all: "Deselect All",
    cancel_selection: "Cancel Selection",
  },
  note: {
    loading: "Loading note...",
    not_found: "Note could not be loaded.",
    edit_title: "Edit Note",
    saving: "Saving...",
    saved: "Saved",
    error: "Error",
  },
  status: {
    label: "Status",
    select: "Select status...",
    draft: "Draft",
    review: "Review",
    published: "Published",
  },
  business: {
    alert_sent: "Alert sent to {contact}",
  },
} as const;

// Helper type: Recursively converts the literal types of 'en' (e.g. "Save")
// into generic 'string' types, while preserving the key structure.
type DeepString<T> = {
  [K in keyof T]: T[K] extends object ? DeepString<T[K]> : string;
};

// Derive the schema type from English, but loosen value types to string
export type TranslationSchema = DeepString<typeof en>;
