import fs from 'fs';
import path from 'path';

export interface StorageService {
  uploadFile(file: Express.Multer.File): Promise<string>;
  getFileStream(storageKey: string): fs.ReadStream;
  getFilePath(storageKey: string): string;
}

export class LocalStorageService implements StorageService {
  private uploadDir: string;

  constructor() {
    this.uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const destinationPath = path.join(this.uploadDir, fileName);

    // Mover o arquivo (multer salva em temp)
    fs.renameSync(file.path, destinationPath);
    return fileName;
  }

  getFileStream(storageKey: string): fs.ReadStream {
    const filePath = this.getFilePath(storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error('Arquivo não encontrado no disco.');
    }
    return fs.createReadStream(filePath);
  }

  getFilePath(storageKey: string): string {
    return path.join(this.uploadDir, storageKey);
  }
}

// Singleton export para facilitar injeção futura
export const storageService: StorageService = new LocalStorageService();
