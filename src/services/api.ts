// API service for Firebase Cloud Functions communication

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/cuidador-digital/us-central1';

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async post(endpoint: string, data: any) {
    try {
      console.log(`🔄 API POST to: ${this.baseUrl}${endpoint}`);
      console.log('📤 Request data:', JSON.stringify(data, null, 2));
      
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      console.log(`📥 Response status: ${response.status} ${response.statusText}`);

      const result = await response.json();
      console.log('📥 Response data:', result);

      if (!response.ok) {
        console.error(`❌ API Error Response:`, result);
        throw new Error(result.error || result.message || `HTTP error! status: ${response.status}`);
      }

      console.log('✅ API Success:', result);
      return result;
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(
          `Cannot connect to Firebase Functions at ${this.baseUrl}. 
           Make sure Firebase emulator is running or check your production URL.`
        );
      }
      
      throw error;
    }
  }

  async get(endpoint: string) {
    try {
      console.log(`🔄 API GET to: ${this.baseUrl}${endpoint}`);
      
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      const result = await response.json();
      
      if (!response.ok) {
        console.error(`❌ API Error Response:`, result);
        throw new Error(result.error || result.message || `HTTP error! status: ${response.status}`);
      }

      console.log('✅ API Success:', result);
      return result;
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(
          `Cannot connect to Firebase Functions at ${this.baseUrl}. 
           Make sure Firebase emulator is running or check your production URL.`
        );
      }
      
      throw error;
    }
  }

  // Registration and core functionality
  async saveRegistration(formData: any) {
    console.log('🚀 Submitting registration to Firebase Functions...');
    return await this.post('/saveRegistration', formData);
  }

  async generateReport(idosoId: string, date: string) {
    return await this.get(`/generateReport?idosoId=${idosoId}&date=${date}`);
  }

  async getHealthStatus() {
    return await this.get('/getHealthStatus');
  }

  async handleWhatsAppWebhook(data: any) {
    return await this.post('/handleWhatsAppWebhook', data);
  }

  async testTwilio() {
    return await this.get('/testTwilio');
  }

  // Stripe payment methods
  async createCheckoutSession(plan: "basic" | "family" | "premium", uid: string, email?: string) {
    return await this.post('/createCheckoutSession', { plan, uid, email });
  }

  // CSV export for Power BI
  async generateReportCsv(idosoId: string) {
    return await this.get(`/generateReportCsv?idosoId=${idosoId}`);
  }
}

export const apiService = new ApiService();