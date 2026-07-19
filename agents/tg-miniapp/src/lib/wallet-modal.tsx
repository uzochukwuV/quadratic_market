/**
 * Minimal custom wallet modal — replaces @solana/wallet-adapter-react-ui.
 * Uses the Wallet Standard wallets surfaced by @solana/wallet-adapter-react.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { X, Wallet as WalletIcon } from "lucide-react";
import { cn } from "./utils";

// ── Context ───────────────────────────────────────────────────────────────────

interface WalletModalCtx {
  visible: boolean;
  setVisible: (v: boolean) => void;
}

const WalletModalContext = createContext<WalletModalCtx>({
  visible: false,
  setVisible: () => {},
});

export function useWalletModal() {
  return useContext(WalletModalContext);
}

// ── Modal UI ──────────────────────────────────────────────────────────────────

function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, connecting } = useWallet();

  const detected = wallets.filter(
    (w) => w.readyState === "Installed" || w.readyState === "Loadable"
  );
  const notDetected = wallets.filter(
    (w) => w.readyState !== "Installed" && w.readyState !== "Loadable"
  );
  const list = detected.length > 0 ? detected : wallets;

  const handleSelect = useCallback(
    (walletName: string) => {
      select(walletName as any);
      onClose();
    },
    [select, onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-w-[430px] mx-auto rounded-t-2xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
          <h2 className="text-base font-bold">Connect Wallet</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-secondary/60 text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2 pb-8">
          {list.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
              <WalletIcon className="w-10 h-10 opacity-30" />
              <p className="text-sm text-center">
                No wallet detected. Install{" "}
                <a
                  href="https://phantom.app/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Phantom
                </a>{" "}
                or{" "}
                <a
                  href="https://solflare.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Solflare
                </a>{" "}
                to continue.
              </p>
            </div>
          )}

          {list.map((w) => (
            <button
              key={w.adapter.name}
              onClick={() => handleSelect(w.adapter.name)}
              disabled={connecting}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
                "border border-border/40 bg-secondary/30 text-left",
                "hover:bg-secondary/60 hover:border-primary/30 active:scale-[0.99]",
                "transition-all duration-150 disabled:opacity-50"
              )}
            >
              {w.adapter.icon ? (
                <img
                  src={w.adapter.icon}
                  alt={w.adapter.name}
                  className="w-8 h-8 rounded-lg"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <WalletIcon className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className="flex-1">
                <div className="text-sm font-bold">{w.adapter.name}</div>
                <div className="text-[11px] text-muted-foreground capitalize">
                  {w.readyState === "Installed"
                    ? "Detected"
                    : w.readyState === "Loadable"
                    ? "Ready to use"
                    : "Not installed"}
                </div>
              </div>
            </button>
          ))}

          <p className="text-center text-[11px] text-muted-foreground pt-2">
            Modern Solana wallets (Phantom, Solflare, Backpack) are
            auto-detected via the Wallet Standard.
          </p>
        </div>
      </div>
    </>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      {visible && <WalletModal onClose={() => setVisible(false)} />}
    </WalletModalContext.Provider>
  );
}
