#!/usr/bin/env bash

# ==========================================
# LOAD CONFIGURATION
# ==========================================
CONFIG_FILE="concat.config"

if [ -f "$CONFIG_FILE" ]; then
    # shellcheck source=concat.config
    source "$CONFIG_FILE"
else
    echo "Error: $CONFIG_FILE not found."
    exit 1
fi

# ==========================================
# SAFETY CHECKS (THE FIX)
# ==========================================
# If OUTPUT_FILE is missing in config, default to a safe name
# to prevent "mv: cannot overwrite directory" errors.
if [ -z "$OUTPUT_FILE" ]; then
    OUTPUT_FILE="a.txt"
    echo "⚠️  WARNING: OUTPUT_FILE not defined in config. Defaulting to: $OUTPUT_FILE"
fi

# ==========================================
# SETUP
# ==========================================

# 1. Remove the old output file immediately
if [ -f "$OUTPUT_FILE" ]; then
    rm "$OUTPUT_FILE"
fi

# 2. Use a temporary file for writing
TEMP_FILE="${OUTPUT_FILE}.tmp"
SCRIPT_NAME=$(basename "$0")

echo "📦 Bundling project files into $OUTPUT_FILE..."

# Clear/Create the temp file
: >"$TEMP_FILE"

# Ensure the temp file is removed if the script crashes
trap 'rm -f "$TEMP_FILE"' EXIT

# ==========================================
# PART 1: WEB PROJECT FILES
# ==========================================

# We write everything to the TEMP_FILE first
{
    echo "--- Starting with Web Project Files ---"

    # Start find arguments
    find_args=(.)

    # 3. Exclude script and config artifacts
    find_args+=(-not -name "$CONFIG_FILE")
    find_args+=(-not -name "$SCRIPT_NAME")
    find_args+=(-not -name "$TEMP_FILE")
    find_args+=(-not -name "$OUTPUT_FILE")

    # Add Configured Prunes
    # Check if WEB_PRUNES exists to avoid errors if empty
    if [ ${#WEB_PRUNES[@]} -gt 0 ]; then
        for path in "${WEB_PRUNES[@]}"; do
            find_args+=(-path "$path" -prune -o)
        done
    fi

    # Finalize: Files only, Print result
    find_args+=(-type f -print)

    # Execute Find -> Loop
    find "${find_args[@]}" | while IFS= read -r file; do
        echo "File: $file"
        echo "------------------------"
        cat "$file"
        echo ""
        echo ""
    done

} >>"$TEMP_FILE"

# ==========================================
# PART 2: ANDROID FILES (OPTIONAL)
# ==========================================

if [[ "$1" == "mob" ]]; then
    echo "--- Adding Android Project Files ---"

    {
        echo "--- Adding Android Project Files ---"

        if [ ${#ANDROID_INCLUDES[@]} -gt 0 ]; then
            for item in "${ANDROID_INCLUDES[@]}"; do
                if [ -d "$item" ]; then
                    find "$item" -type f | while IFS= read -r file; do
                        echo "File: $file"
                        echo "------------------------"
                        cat "$file"
                        echo -e "\n\n"
                    done
                elif [ -f "$item" ]; then
                    echo "File: $item"
                    echo "------------------------"
                    cat "$item"
                    echo -e "\n\n"
                fi
            done
        fi
    } >>"$TEMP_FILE"
fi

# ==========================================
# FINALIZE
# ==========================================

# 4. Move the temporary file to the final destination
mv "$TEMP_FILE" "$OUTPUT_FILE"

# Reset trap so it doesn't delete the file we just moved
trap - EXIT

echo "✅ Done! Project content is in $OUTPUT_FILE"
echo "You can now copy the contents of that file and paste it in the chat."
