/**
 * Cloud service abstraction for file downloads
 * Provides a common interface for different cloud storage providers
 */

export interface CloudFileMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size?: number;
  duration?: number;
}

export interface CloudDownloadOptions {
  password?: string;
}

export interface CloudDownloadResult {
  success: boolean;
  metadata?: CloudFileMetadata;
  tempPath?: string;
  error?: string;
}

export interface CloudService {
  /**
   * Service name (e.g., "Google Drive", "Dropbox")
   */
  readonly name: string;

  /**
   * One-line human description shown in `scribe --help` and `scribe list-sources`.
   * Optional — adapters that don't set this won't appear in the docs section.
   */
  readonly description?: string;

  /**
   * Example URLs accepted by this service (1〜3 件)。
   * Optional — purely for documentation in --help / list-sources.
   */
  readonly urlExamples?: readonly string[];

  /**
   * Check if URL belongs to this service
   */
  isValidUrl(url: string): boolean;

  /**
   * Extract file ID from URL
   */
  extractFileId(url: string): string | null;

  /**
   * Get file metadata
   */
  getFileMetadata(fileId: string, opts?: CloudDownloadOptions): Promise<CloudFileMetadata>;

  /**
   * Download file to temporary path
   */
  downloadFile(fileId: string, tempPath: string, opts?: CloudDownloadOptions): Promise<boolean>;

  /**
   * Check if file is a media file that should be transcribed
   */
  isMediaFile(mimeType: string): boolean;

  /**
   * Preferred temporary file extension for downloads (without dot)
   */
  getPreferredFileExtension?(): string;
}

/**
 * Base implementation with common functionality
 */
export abstract class BaseCloudService implements CloudService {
  abstract readonly name: string;
  abstract isValidUrl(url: string): boolean;
  abstract extractFileId(url: string): string | null;
  abstract getFileMetadata(fileId: string, opts?: CloudDownloadOptions): Promise<CloudFileMetadata>;
  abstract downloadFile(fileId: string, tempPath: string, opts?: CloudDownloadOptions): Promise<boolean>;

  /**
   * Common media file check
   */
  isMediaFile(mimeType: string): boolean {
    const mediaTypes = [
      'audio/', 'video/',
      'application/octet-stream', // Generic binary
    ];
    
    return mediaTypes.some(type => mimeType.startsWith(type));
  }

  /**
   * Common error handling wrapper
   */
  protected async handleDownloadError<T>(
    operation: () => Promise<T>,
    errorMessage: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error(`${this.name} - ${errorMessage}:`, error);
      throw new Error(`${this.name}: ${errorMessage} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getPreferredFileExtension(): string {
    return 'tmp';
  }
}

/**
 * Registry for cloud services
 */
export class CloudServiceRegistry {
  private services: Map<string, CloudService> = new Map();

  /**
   * Register a cloud service
   */
  register(service: CloudService): void {
    this.services.set(service.name.toLowerCase(), service);
  }

  /**
   * Get service for URL
   */
  getServiceForUrl(url: string): CloudService | null {
    for (const service of this.services.values()) {
      if (service.isValidUrl(url)) {
        return service;
      }
    }
    return null;
  }

  /**
   * Get service by name
   */
  getServiceByName(name: string): CloudService | null {
    return this.services.get(name.toLowerCase()) || null;
  }

  /**
   * Get all registered services
   */
  getAllServices(): CloudService[] {
    return Array.from(this.services.values());
  }
}

// Global registry instance
export const cloudServiceRegistry = new CloudServiceRegistry();