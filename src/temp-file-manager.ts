/**
 * Temporary file management utility
 * Handles creation, cleanup, and management of temporary files
 */

export class TempFileManager {
  private tempPaths: Set<string> = new Set();
  private tempDirs: Set<string> = new Set();

  /**
   * Create a temporary directory
   */
  async createTempDir(): Promise<string> {
    const tempDir = await Deno.makeTempDir();
    this.tempDirs.add(tempDir);
    return tempDir;
  }

  /**
   * Create a temporary file path
   */
  async createTempFile(prefix: string, extension: string): Promise<string> {
    const tempDir = await this.createTempDir();
    const filename = `${prefix}_${Date.now()}.${extension}`;
    const tempPath = `${tempDir}/${filename}`;
    this.tempPaths.add(tempPath);
    return tempPath;
  }

  /**
   * Create a temporary file path for Google Drive
   */
  async createGoogleDriveTempFile(): Promise<string> {
    const tempDir = await this.createTempDir();
    const tempPath = `${tempDir}/gdrive_${Date.now()}.tmp`;
    this.tempPaths.add(tempPath);
    return tempPath;
  }

  /**
   * Clean up a specific file
   */
  async cleanupFile(path: string): Promise<void> {
    try {
      await Deno.remove(path);
      this.tempPaths.delete(path);
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Clean up a specific directory
   */
  async cleanupDir(path: string): Promise<void> {
    try {
      await Deno.remove(path, { recursive: true });
      this.tempDirs.delete(path);
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Clean up all tracked temporary files and directories
   */
  async cleanupAll(): Promise<void> {
    // Clean up files first
    for (const path of this.tempPaths) {
      await this.cleanupFile(path);
    }

    // Then clean up directories
    for (const dir of this.tempDirs) {
      await this.cleanupDir(dir);
    }

    this.tempPaths.clear();
    this.tempDirs.clear();
  }

  /**
   * Extract directory from file path and clean up both
   */
  async cleanupFileAndDir(filePath: string): Promise<void> {
    await this.cleanupFile(filePath);
    
    const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (this.tempDirs.has(dirPath)) {
      await this.cleanupDir(dirPath);
    }
  }

  /**
   * Write data to a temporary file
   */
  async writeToTempFile(data: Uint8Array, prefix: string, extension: string): Promise<string> {
    const tempPath = await this.createTempFile(prefix, extension);
    await Deno.writeFile(tempPath, data);
    return tempPath;
  }
}