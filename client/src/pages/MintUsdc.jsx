import React from 'react';
import WalletConnection from '@/components/tradebook/WalletConnection';

export default function MintUsdc() {
  return (
    <div className="bg-canvas text-midnight font-inter min-h-screen pt-[80px]">
      <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-12">
        <div className="bg-canvas border border-light-pearl rounded-[8px] p-6 shadow-sm">
          <h1 className="text-2xl font-semibold mb-4">Mint Test USDC (Devnet)</h1>
          <p className="text-sm text-silver-ash mb-4">Use the devnet faucet to mint test USDC to your associated token account (ATA).</p>
          <WalletConnection />
        </div>
      </div>
    </div>
  );
}
