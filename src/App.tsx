import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Pricing from './components/Pricing';
import RegistrationFlow from './components/RegistrationFlow';
import Testimonials from './components/Testimonials';
import Footer from './components/Footer';
import AdminPanel from './components/AdminPanel';
import TestingPanel from './components/TestingPanel';

function App() {
  const [showAdmin, setShowAdmin] = useState(false);

  // Show admin panel if URL contains ?admin=true
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setShowAdmin(urlParams.get('admin') === 'true');
  }, []);

  if (showAdmin) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="container mx-auto px-6 py-8">
          <div className="mb-8">
            <button
              onClick={() => setShowAdmin(false)}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              ← Voltar ao Site
            </button>
          </div>
          
          <div className="space-y-8">
            <AdminPanel />
            <TestingPanel />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <RegistrationFlow />
      <Testimonials />
      <Footer />
    </div>
  );
}

export default App;