"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

function shortAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const { connected, connecting, disconnect, publicKey, wallet } = useWallet();
  const walletModal = useWalletModal();

  if (connected && publicKey) {
    return (
      <button className="wallet-button connected" type="button" onClick={() => void disconnect()}>
        <span>{wallet?.adapter.name ?? "Wallet"}</span>
        <b>{shortAddress(publicKey.toBase58())}</b>
      </button>
    );
  }

  return (
    <button className="wallet-button" type="button" onClick={() => walletModal.setVisible(true)} disabled={connecting}>
      {connecting ? "Connecting" : "Connect wallet"}
    </button>
  );
}
