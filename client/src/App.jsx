import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
import Landing from '@/pages/Landing';
import Dashboard from '@/pages/Dashboard';
import { Navigate } from 'react-router-dom';

const AuthenticatedApp = () => {
  

  // Render the main app
  return (
    <Routes>
     
      <Route path="/" element={<Landing />} />
     
        <Route path="/dashboard" element={<Dashboard />} />
     
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
   
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
  
  )
}

export default App