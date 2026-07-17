"use client";

import { Blink, useBlink } from "@dialectlabs/blinks";
import { useBlinkSolanaWalletAdapter } from "@dialectlabs/blinks/hooks/solana";
import { frontendEnv } from "@/lib/env";
import "@dialectlabs/blinks/index.css";

interface BlinkPanelProps {
  actionUrl: string;
  title?: string;
}

export function BlinkPanel({ actionUrl, title }: BlinkPanelProps) {
  const { adapter } = useBlinkSolanaWalletAdapter(frontendEnv.rpcUrl);
  const { blink, isLoading } = useBlink({ url: actionUrl });

  return (
    <div className="glass-card rounded-card p-6">
      {title && (
        <h3 className="text-[15px] font-semibold text-white mb-4">{title}</h3>
      )}
      {isLoading || !blink ? (
        <div className="flex items-center justify-center h-48">
          <div className="flex items-center gap-2.5 text-whisper-gray text-[14px]">
            <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            Loading action...
          </div>
        </div>
      ) : (
        <Blink
          blink={blink}
          adapter={adapter}
          securityLevel="all"
          stylePreset="x-dark"
        />
      )}
    </div>
  );
}
