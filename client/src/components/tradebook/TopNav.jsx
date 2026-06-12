import React, { useEffect, useState } from "react";
import { Link } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';

const navLinks = ["Live", "Pre-Match", "Outrights", "My Bets", "Results"];

export default function TopNav({ activeNav, setActiveNav }) {
  const { toast } = useToast();
  const [wallet, setWallet] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (window.solana && window.solana.isPhantom && window.solana.isConnected) {
      setWallet(window.solana);
      setConnected(true);
    }
  }, []);

  const connect = async () => {
    if (!window.solana) return toast({ title: 'No wallet found', description: 'Install Phantom' });
    try {
      const resp = await window.solana.connect();
      setWallet(window.solana);
      setConnected(true);
      toast({ title: 'Wallet connected', description: resp.publicKey.toString() });
    } catch (e) {
      toast({ title: 'Unable to connect wallet' });
    }
  };

  const disconnect = async () => {
    try {
      if (window.solana && window.solana.disconnect) await window.solana.disconnect();
    } catch (e) {}
    setWallet(null);
    setConnected(false);
    toast({ title: 'Wallet disconnected' });
  };

  return (
    <header className="sticky top-0 z-50 bg-canvas border-b border-light-pearl h-[60px] flex items-center px-6 lg:px-10">
      <div className="flex items-center gap-2 mr-8 shrink-0">
        <span className="text-lg">⚽</span>
        <span className="font-inter font-bold text-lg text-midnight tracking-tight">TradeBook</span>
      </div>

      <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
        {navLinks.map((link) => (
          <button
            key={link}
            onClick={() => setActiveNav(link)}
            className={`font-inter text-[15px] px-4 py-[18px] relative transition-colors ${
              activeNav === link
                ? "text-midnight font-semibold"
                : "text-dark-shale hover:text-midnight"
            }`}
          >
            {link}
            {activeNav === link && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-midnight rounded-full" />
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        <div className="bg-sunset-orange/10 px-4 py-1.5 rounded-full">
          <span className="font-inter text-sm font-semibold text-sunset-orange">₦ 45,200.00</span>
        </div>

        <Link to="/mint-usdc" className="inline-flex font-inter text-sm font-medium text-white bg-midnight px-4 py-1.5 rounded-[20px] hover:opacity-95 transition-colors">Mint USDC</Link>

        <div>
          {connected ? (
            <div className="hidden sm:flex items-center gap-3">
              <span className="font-inter text-sm text-silver-ash bg-canvas border border-light-pearl rounded-full px-3 py-1">{wallet?.publicKey?.toString?.()?.slice(0,6)}...{wallet?.publicKey?.toString?.()?.slice(-4)}</span>
              <button
                onClick={disconnect}
                className="inline-flex items-center gap-2 bg-canvas border border-midnight text-midnight font-inter text-sm px-3 py-1.5 rounded-[20px] hover:bg-midnight/5 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              className="inline-flex items-center gap-2 bg-midnight text-canvas font-inter font-semibold text-[14px] px-4 py-1.5 rounded-[20px] hover:bg-midnight/85 transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
