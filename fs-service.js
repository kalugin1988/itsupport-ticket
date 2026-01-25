// fs-service.js
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class FileService {
    constructor() {
        this.baseUrl = process.env.FS_BASE_URL || 'https://filebridge.itschool25.ru';
        this.token = process.env.FS_TOKEN || '8998cefe09823a9267731f37ddb4f4ac40ad7c4f5fba584530030c16b4f8de6e';
        this.serviceName = process.env.FS_SERVICE_NAME || 'itsupport';
        
        this.axios = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
            headers: {
                'X-API-Token': this.token,
                'Content-Type': 'application/json'
            }
        });
    }

    // Проверка подключения
    async checkConnection() {
        try {
            const response = await this.axios.get('/api/stats');
            return { 
                connected: true, 
                message: 'Подключено к файловому сервису',
                stats: response.data 
            };
        } catch (error) {
            console.error('Ошибка подключения к FS:', error.message);
            return { 
                connected: false, 
                message: 'Не удалось подключиться к файловому сервису',
                error: error.message 
            };
        }
    }

    // Загрузка файла
    async uploadFile(filePath, userId, ticketId, description = '') {
        try {
            const fileName = path.basename(filePath);
            const fileStats = fs.statSync(filePath);
            
            const formData = new FormData();
            formData.append('service_name', this.serviceName);
            formData.append('login', userId.toString());
            formData.append('description', `Заявка #${ticketId}: ${description || fileName}`);
            formData.append('file', fs.createReadStream(filePath), {
                filename: fileName,
                knownLength: fileStats.size
            });

            const response = await axios.post(`${this.baseUrl}/api/upload`, formData, {
                headers: {
                    'X-API-Token': this.token,
                    ...formData.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            return {
                success: true,
                fileNumber: response.data.file_number,
                fileName: response.data.filename,
                originalName: fileName,
                size: fileStats.size,
                uploadedAt: response.data.uploaded_at,
                url: `${this.baseUrl}/api/download/${response.data.file_number}`,
                downloadUrl: `${this.baseUrl}/api/download/${response.data.file_number}?token=${this.token.substring(0, 8)}...`
            };

        } catch (error) {
            console.error('Ошибка загрузки файла в FS:', error.message);
            return {
                success: false,
                error: error.message,
                response: error.response?.data
            };
        }
    }

    // Загрузка нескольких файлов
    async uploadFiles(files, userId, ticketId) {
        const results = [];
        for (const file of files) {
            const result = await this.uploadFile(file.path, userId, ticketId, file.originalname);
            results.push({
                ...result,
                originalName: file.originalname,
                tempPath: file.path
            });
        }
        return results;
    }

    // Получение информации о файле
    async getFileInfo(fileNumber) {
        try {
            const response = await this.axios.get(`/api/file/${fileNumber}`);
            return {
                success: true,
                ...response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                response: error.response?.data
            };
        }
    }

    // Получение файлов для заявки
    async getTicketFiles(ticketId, userId) {
        try {
            // Ищем файлы по описанию (содержит номер заявки)
            const response = await this.axios.get(`/api/files/${userId}`);
            const allFiles = Array.isArray(response.data) ? response.data : [];
            
            // Фильтруем файлы по описанию (содержит номер заявки)
            const ticketFiles = allFiles.filter(file => 
                file.description && file.description.includes(`Заявка #${ticketId}`)
            );
            
            return {
                success: true,
                files: ticketFiles,
                count: ticketFiles.length
            };
        } catch (error) {
            return {
                success: false,
                files: [],
                error: error.message
            };
        }
    }

    // Удаление файла
    async deleteFile(fileNumber) {
        try {
            const response = await this.axios.delete(`/api/file/${fileNumber}`);
            return {
                success: true,
                message: 'Файл удален',
                data: response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                response: error.response?.data
            };
        }
    }

    // Получение прямого URL для скачивания
    getDownloadUrl(fileNumber, inline = false) {
        const url = `${this.baseUrl}/api/download/${fileNumber}`;
        return inline ? `${url}?inline=true` : url;
    }

    // Получение статистики
    async getStats() {
        try {
            const response = await this.axios.get('/api/stats');
            return {
                success: true,
                ...response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new FileService();