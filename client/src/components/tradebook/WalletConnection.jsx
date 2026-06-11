import React, { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { postJSON } from '@/lib/api';

// Parent component that owns wallet state and composes two focused components:
// - WalletConnector: handles connect / disconnect UI
// - TestUsdcMinter: handles minting test USDC (talks to backend)

function WalletConnector({ wallet, connected, onConnect, onDisconnect }) {
  return (
    <div className="mb-6">
      {connected ? (
        <div className="flex items-center gap-3">
          <div className="font-inter text-sm text-midnight bg-canvas border border-light-pearl rounded-full px-3 py-1">
            {wallet?.publicKey?.toString?.()?.slice(0, 6)}...{wallet?.publicKey?.toString?.()?.slice(-4)}
          </div>
          <button
            onClick={onDisconnect}
            className="inline-flex items-center gap-2 bg-canvas border border-midnight text-midnight font-inter text-sm px-3 py-1.5 rounded-[20px] hover:bg-midnight/5 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={onConnect}
          className="inline-flex items-center gap-2 bg-midnight text-canvas font-inter font-semibold text-[14px] px-5 py-2 rounded-[20px] hover:bg-midnight/85 transition-colors"
        >
          Connect Wallet
        </button>
      )}
    </div>
  );
}

function TestUsdcMinter({ wallet, connected }) {
  const { toast } = useToast();
  const [recipient, setRecipient] = useState('');

  useEffect(() => {
    // default recipient to connected wallet pubkey when available
    if (connected && wallet?.publicKey) setRecipient(wallet.publicKey.toString());
  }, [connected, wallet]);

  const mintTestUsdc = async () => {
    if (!connected || !wallet) return toast({ title: 'Connect wallet first' });
    const pub = recipient || (wallet && wallet.publicKey && wallet.publicKey.toString()) || '';
    try {
      const j = await postJSON('/mint-test-usdc', { recipient: pub });
      if (j.ok) {
        toast({ title: 'ATA Created', description: j.ata });
      } else {
        toast({ title: 'Error', description: j.error || 'Mint failed' });
      }
    } catch (err) {
      toast({ title: 'Network error', description: err.message || String(err) });
    }
  };

  return (
    <div className="bg-canvas border border-light-pearl rounded-[8px] p-4 shadow-sm">
      <label className="block mb-2 font-inter text-sm text-dark-shale">Recipient (SPL ATA recipient)</label>
      <input
        className="w-full font-inter text-sm border border-light-pearl rounded px-3 py-2 mb-3 bg-white/0"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="Recipient public key"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={mintTestUsdc}
          className="inline-flex items-center gap-2 bg-midnight text-canvas font-inter font-semibold text-[14px] px-5 py-2 rounded-[20px] hover:bg-midnight/85 transition-colors"
          disabled={!connected}
        >
          Mint Test USDC
        </button>
        <span className="font-inter text-sm text-silver-ash">devnet faucet</span>
      </div>
    </div>
  );
}

export default function WalletConnection() {
  const { toast } = useToast();
  const [wallet, setWallet] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // If the extension is already connected, reflect that in state.
    if (window.solana && window.solana.isPhantom && window.solana.isConnected) {
      setWallet(window.solana);
      setConnected(true);
    }

    // No auto-connect listeners to avoid unexpected prompts; leave explicit connect action.
    return () => {};
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
    } catch (e) {
      // ignore
    }
    setWallet(null);
    setConnected(false);
    toast({ title: 'Wallet disconnected' });
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Wallet & Test USDC</h2>
      <WalletConnector wallet={wallet} connected={connected} onConnect={connect} onDisconnect={disconnect} />
      <TestUsdcMinter wallet={wallet} connected={connected} />
    </div>
  );
}
