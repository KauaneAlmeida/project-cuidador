import React, { useState } from 'react';
import { 
  Play, 
  MessageCircle, 
  Clock, 
  AlertTriangle, 
  BarChart3,
  RefreshCw,
  CheckCircle,
  XCircle,
  Activity
} from 'lucide-react';
import { apiService } from '../services/api';

const TestingPanel: React.FC = () => {
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [isRunningTest, setIsRunningTest] = useState<string | null>(null);

  const runTest = async (testName: string, testFunction: () => Promise<any>) => {
    setIsRunningTest(testName);
    setTestResults(prev => ({ ...prev, [testName]: { loading: true } }));
    
    try {
      const result = await testFunction();
      setTestResults(prev => ({ 
        ...prev, 
        [testName]: { 
          success: true, 
          data: result, 
          timestamp: new Date(),
          loading: false
        }
      }));
    } catch (error) {
      setTestResults(prev => ({ 
        ...prev, 
        [testName]: { 
          success: false, 
          error: error.message, 
          timestamp: new Date(),
          loading: false
        }
      }));
    } finally {
      setIsRunningTest(null);
    }
  };

  const tests = [
    {
      id: 'health',
      name: 'Health Check',
      description: 'Verificar status geral do sistema',
      icon: Activity,
      color: 'blue',
      action: () => runTest('health', () => apiService.getHealthStatus())
    },
    {
      id: 'twilio',
      name: 'Test Twilio',
      description: 'Enviar mensagem de teste via WhatsApp',
      icon: MessageCircle,
      color: 'green',
      action: () => runTest('twilio', () => apiService.testTwilio())
    },
    {
      id: 'reminders',
      name: 'Check Reminders',
      description: 'Verificar lembretes de medicação pendentes',
      icon: Clock,
      color: 'purple',
      action: () => runTest('reminders', () => apiService.debugCheckMedicationReminders())
    },
    {
      id: 'alerts',
      name: 'Emergency Alerts',
      description: 'Verificar alertas de emergência',
      icon: AlertTriangle,
      color: 'red',
      action: () => runTest('alerts', () => apiService.debugCheckEmergencyAlerts())
    },
    {
      id: 'reports',
      name: 'Daily Reports',
      description: 'Gerar relatórios diários',
      icon: BarChart3,
      color: 'orange',
      action: () => runTest('reports', () => apiService.debugSendDailyReports())
    }
  ];

  const getColorClasses = (color: string, variant: 'bg' | 'text' | 'border') => {
    const colors = {
      blue: { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' },
      green: { bg: 'bg-green-100', text: 'text-green-600', border: 'border-green-200' },
      purple: { bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-200' },
      red: { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-200' },
      orange: { bg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-200' }
    };
    return colors[color]?.[variant] || colors.blue[variant];
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          🧪 Painel de Testes
        </h2>
        <p className="text-gray-600">
          Execute testes manuais para verificar o funcionamento do sistema
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tests.map((test) => {
          const Icon = test.icon;
          const result = testResults[test.id];
          const isLoading = isRunningTest === test.id;
          
          return (
            <div key={test.id} className="border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center space-x-3 mb-4">
                <div className={`w-10 h-10 ${getColorClasses(test.color, 'bg')} rounded-lg flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${getColorClasses(test.color, 'text')}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{test.name}</h3>
                  <p className="text-sm text-gray-600">{test.description}</p>
                </div>
              </div>

              <button
                onClick={test.action}
                disabled={isLoading}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2 ${
                  isLoading 
                    ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                    : `bg-${test.color}-600 text-white hover:bg-${test.color}-700 transform hover:scale-105`
                }`}
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Executando...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Executar Teste</span>
                  </>
                )}
              </button>

              {/* Test Result */}
              {result && !result.loading && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  result.success 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center space-x-2 mb-2">
                    {result.success ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600" />
                    )}
                    <span className={`text-sm font-medium ${
                      result.success ? 'text-green-800' : 'text-red-800'
                    }`}>
                      {result.success ? 'Sucesso' : 'Erro'}
                    </span>
                  </div>
                  
                  <div className={`text-sm ${
                    result.success ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {result.success ? (
                      <div>
                        {result.data?.message && <p>{result.data.message}</p>}
                        {result.data?.twilioSid && (
                          <p className="font-mono text-xs mt-1">ID: {result.data.twilioSid}</p>
                        )}
                      </div>
                    ) : (
                      <p>{result.error}</p>
                    )}
                  </div>
                  
                  <p className="text-xs text-gray-500 mt-2">
                    {result.timestamp?.toLocaleString('pt-BR')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">💡 Dicas de Teste</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Execute o "Health Check" primeiro para verificar a conectividade</li>
          <li>• Use "Test Twilio" para confirmar que as mensagens WhatsApp estão funcionando</li>
          <li>• "Check Reminders" simula a verificação automática de horários</li>
          <li>• Configure TEST_PHONE_NUMBER no .env para receber mensagens de teste</li>
        </ul>
      </div>
    </div>
  );
};

export default TestingPanel;