import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { M3ShapeLoader } from './M3ShapeLoader';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Sub-Step 7.4.3: React Error Boundary mit robuster OLED-Fallback-Kachel
 * Fängt unvorhergesehene Auth-, Netzwerk- oder Firestore-Exceptions elegant ab,
 * ohne einen leeren oder weißen Bildschirm anzuzeigen.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught unhandled exception:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 selection:bg-emerald-500 selection:text-black font-sans">
          <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8 max-w-sm w-full mx-auto text-center space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Status Icon */}
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto shadow-inner relative">
              <M3ShapeLoader size={32} color="#34d399" />
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
              </span>
            </div>

            {/* Header & Subtitle */}
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Sitzung wird synchronisiert...
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Vorübergehend konnte keine stabile Verbindung zum Cloud-Speicher hergestellt werden. Deine lokalen Pflanzen-Daten bleiben geschützt.
              </p>
            </div>

            {/* Offline & Storage Security Note */}
            <div className="p-3 rounded-2xl bg-zinc-900/60 border border-zinc-850 flex items-center gap-2.5 text-left text-xs text-zinc-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Lokale Daten &amp; Verschlüsselung aktiv</span>
            </div>

            {/* Reload CTA Button */}
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 border border-zinc-800 hover:border-emerald-800/60 font-semibold rounded-xl text-sm transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95 shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Neu laden</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
