import fs from 'fs';
import path from 'path';
import prisma from '../utils/prisma';

export interface StorageService {
  uploadFile(file: Express.Multer.File): Promise<string>;
  getFileData(storageKey: string): Promise<Buffer | null>;
  getFilePath(storageKey: string): string; // Retido para retrocompatibilidade
}

export class DatabaseStorageService implements StorageService {
  async uploadFile(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname);
    const storageKey = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    
    // Lê o arquivo do disco temporário (onde o multer salvou)
    const fileBuffer = fs.readFileSync(file.path);
    
    // Salva o Buffer no banco de dados Prisma
    await prisma.fileData.create({
      data: {
        storageKey,
        data: fileBuffer
      }
    });

    // Remove o arquivo temporário
    try { fs.unlinkSync(file.path); } catch (e) {}

    return storageKey;
  }

  async getFileData(storageKey: string): Promise<Buffer | null> {
    const file = await prisma.fileData.findUnique({
      where: { storageKey }
    });
    return file ? file.data : null;
  }

  getFilePath(storageKey: string): string {
    throw new Error('getFilePath não é suportado no DatabaseStorageService.');
  }
}

export const storageService: StorageService = new DatabaseStorageService();
