declare namespace Bun {
  /**
   * Represents a file on the filesystem accessible by Bun.
   */
  interface BunFile {
    /**
     * Returns the file's contents as a web-standard ReadableStream.
     */
    stream(): ReadableStream;
    // You can add other BunFile methods here if needed, e.g., text(), json()
  }

  /**
   * Creates a reference to a file at a given path.
   * @param path The path to the file.
   */
  function file(path: string): BunFile;

  /**
   * Array of command line arguments passed to the script[cite: 400].
   * Equivalent to process.argv in Node[cite: 400].
   */
  const argv: string[];

  /**
   * Terminates the current Bun process with the given exit code[cite: 401].
   */
  function exit(code?: number): never;
}
