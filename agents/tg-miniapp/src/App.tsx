import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { BetProvider } from '@/lib/bet-context';
import { SolanaWalletProvider } from '@/lib/wallet-provider';

import Home from '@/pages/home';
import Confirm from '@/pages/confirm';
import Positions from '@/pages/positions';
import Result from '@/pages/result';
import Markets from '@/pages/markets';
import Feeds from '@/pages/feeds';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/markets" component={Markets} />
      <Route path="/feeds" component={Feeds} />
      <Route path="/confirm" component={Confirm} />
      <Route path="/positions" component={Positions} />
      <Route path="/result/:id" component={Result} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <TooltipProvider>
          <BetProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
          </BetProvider>
          <Toaster />
        </TooltipProvider>
      </SolanaWalletProvider>
    </QueryClientProvider>
  );
}

export default App;
