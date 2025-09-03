import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Pill, 
  MessageCircle, 
  BarChart3, 
  AlertTriangle,
  RefreshCw,
  Send,
  Download,
  Activity
} from 'lucide-react';
import { apiService } from '../services/api';

interface AdminPanelProps {
  className?: string;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ className = '' }) => {
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [testResults, setTestResults] = useState<any>({});

  const loadHealthStatus = async () => {
    setIsLoading(true);
    try {
      const status = await apiService.getHealthStatus();
      setHealthStatus(status);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading health status:', error);
      setHealthStatus({ status: 'error', error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHealthStatus();
  }, []);

  const runTest = async (testName: string, testFunction: () => Promise<any>) => {
    setTestResults(prev => ({ ...prev, [testName]: { loading: true } }));
    
    try {
      const result = await testFunction();
      setTestResults(prev => ({ 
        ...prev, 
        [testName]: { success: true, data: result, timestamp: new Date() }
      }));
    } catch (error) {
      setTestResults(prev => ({ 
        ...prev, 
        [testName]: { success: false, error: error.message, timestamp: new Date() }
      }));
    }
  };

  const testFunctions = [
    {
      name: 'testTwilio',
      label: 'Test Twilio WhatsApp',
      description: 'Send test message to configured test number',
      icon: MessageCircle,
      action: () => runTest('testTwilio', () => apiService.testTwilio())
    },
    {
      name: 'checkReminders',
      label: 'Check Medication Reminders',
      description: 'Manually trigger reminder check',
      icon: Pill,
      action: () => runTest('checkReminders', () => apiService.debugCheckMedicationReminders())
    },
    {
      name: 'checkAlerts',
      label: 'Check Emergency Alerts',
      description: 'Check for unanswered reminders',
      icon: AlertTriangle,
      action: () => runTest('checkAlerts', () => apiService.debugCheckEmergencyAlerts())
    },
    {
      name: 'dailyReports',
      label: 'Send Daily Reports',
      description: 'Trigger daily report generation',
      icon: BarChart3,
      action: () => runTest('dailyReports', () => apiService.debugSendDailyReports())
    }
  ];

  return (
    <div className={`bg-white rounded-2xl shadow-xl p-8 ${className}`}>
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center">
            <Activity className="w-6 h-6 mr-3 text-blue-600" />
            Painel Administrativo
          </h2>
          <button
            onClick={loadHealthStatus}
            disabled={isLoading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
        
        {lastUpdate && (
          <p className="text-sm text-gray-600">
            Última atualização: {lastUpdate.toLocaleString('pt-BR')}
          </p>
        )}
      </div>

      {/* Health Status */}
      {healthStatus && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Status do Sistema</h3>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className={`p-4 rounded-lg border-2 ${
              healthStatus.status === 'healthy' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Firebase</span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  healthStatus.services?.firebase ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {healthStatus.services?.firebase ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            <div className={`p-4 rounded-lg border-2 ${
              healthStatus.services?.twilio ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Twilio</span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  healthStatus.services?.twilio ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {healthStatus.services?.twilio ? 'Configurado' : 'Pendente'}
                </span>
              </div>
            </div>

            <div className={`p-4 rounded-lg border-2 ${
              healthStatus.services?.stripe ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Stripe</span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  healthStatus.services?.stripe ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {healthStatus.services?.stripe ? 'Configurado' : 'Não configurado'}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-lg border-2 border-blue-200 bg-blue-50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Ambiente</span>
                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                  {healthStatus.environment?.isEmulator ? 'Emulador' : 'Produção'}
                </span>
              </div>
            </div>
          </div>

          {/* Database Stats */}
          {healthStatus.database && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-3">Estatísticas do Banco</h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-blue-600">{healthStatus.database.responsaveis}</div>
                  <div className="text-sm text-gray-600">Responsáveis</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">{healthStatus.database.idosos}</div>
                  <div className="text-sm text-gray-600">Idosos</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-purple-600">{healthStatus.database.medicamentosAtivos}</div>
                  <div className="text-sm text-gray-600">Medicamentos Ativos</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Test Functions */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Testes e Depuração</h3>
        
        <div className="grid md:grid-cols-2 gap-4">
          {testFunctions.map((test) => {
            const Icon = test.icon;
            const result = testResults[test.name];
            
            return (
              <div key={test.name} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <Icon className="w-5 h-5 text-blue-600" />
                    <div>
                      <h4 className="font-medium text-gray-900">{test.label}</h4>
                      <p className="text-sm text-gray-600">{test.description}</p>
                    </div>
                  </div>
                  
                  <button
                    onClick={test.action}
                    disabled={result?.loading}
                    className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
                  >
                    {result?.loading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>{result?.loading ? 'Executando...' : 'Executar'}</span>
                  </button>
                </div>

                {result && !result.loading && (
                  <div className={`mt-3 p-3 rounded-lg text-sm ${
                    result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                  }`}>
                    {result.success ? (
                      <div className="text-green-800">
                        <p className="font-medium">✅ Sucesso</p>
                        {result.data?.message && <p>{result.data.message}</p>}
                        {result.data?.twilioSid && <p>ID: {result.data.twilioSid}</p>}
                      </div>
                    ) : (
                      <div className="text-red-800">
                        <p className="font-medium">❌ Erro</p>
                        <p>{result.error}</p>
                      </div>
                    )}
                    <p className="text-gray-600 text-xs mt-1">
                      {result.timestamp?.toLocaleString('pt-BR')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Configuration Info */}
      {healthStatus?.config && (
        <div className="mt-8 bg-gray-50 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 mb-3">Configuração</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Número Twilio:</span>
              <span className="font-mono text-gray-900">{healthStatus.config.twilioPhone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Número de Teste:</span>
              <span className="font-mono text-gray-900">{healthStatus.config.testPhone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Horário Brasil:</span>
              <span className="font-mono text-gray-900">{healthStatus.brazilTime}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;