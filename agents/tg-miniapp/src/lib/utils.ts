import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatOdds(odds: number) {
  return `${odds.toFixed(2)}×`;
}

export function formatSol(sol: number) {
  return `${sol.toFixed(2)} SOL`;
}
