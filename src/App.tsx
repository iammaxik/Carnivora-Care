import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  arrayUnion,
} from 'firebase/firestore';
import {
  Plus,
  Trash2,
  Camera,
  UploadCloud,
  X,
  Sparkles,
  Leaf,
  Loader2,
  Layers,
  ThermometerSnowflake,
  SunMedium,
  Droplets,
  AlertTriangle,
  Activity,
  CloudSun,
  MapPin,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Zap,
  ChevronDown,
  Check,
  ChevronRight,
  History,
  Clock,
  BookOpen,
  Settings,
  ArrowLeft,
  Sliders,
  Users,
  User as UserIcon,
} from 'lucide-react';
import {
  db,
  auth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInWithCredential,
  type User,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './firebase';

export interface PlantDiagnosisRecord {
  diagnosedAt: Timestamp | { seconds: number; nanoseconds?: number };
  score: number;
  summary: string;
}

export interface PlantScanRecord {
  timestamp: Timestamp | { seconds: number; nanoseconds?: number };
  vitalityScore: number;
  diagnosisSummary: string;
  immediateAction?: string;
}

export interface PlantDoc {
  id: string;
  name: string;
  species: string;
  zipCode: string;
  isDormant?: boolean;
  createdAt?: Timestamp | null;
  lastWateredAt?: Timestamp | null;
  wateringHistory?: (Timestamp | { seconds: number; nanoseconds?: number })[];
  diagnosisHistory?: PlantDiagnosisRecord[];
  scans?: PlantScanRecord[];
}

export interface ZipValidationState {
  status: 'idle' | 'loading' | 'valid' | 'invalid';
  city?: string;
  stateCode?: string;
}

export interface WeatherData {
  temperature: number;
  cityName?: string;
  loading?: boolean;
  error?: boolean;
  isFallback?: boolean;
}

// 15 Minuten Cache-Gültigkeit (TTL) für automatische Hintergrund-Aktualisierung
const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedWeatherData {
  temperature: number;
  cityName?: string;
  isFallback?: boolean;
  timestamp: number;
}

// In-Memory-Cache zur Vermeidung redundanter API-Aufrufe mit 15-Minuten-Verfallszeit (TTL)
const weatherCache = new Map<string, CachedWeatherData>();

export interface DormancyEvaluation {
  statusType: 'DORMANZ_ACTIVE' | 'GROWTH_ACTIVE' | 'SUBTROPICAL';
  badgeLabel: string;
  badgeClass: string;
  dotClass: string;
  bannerText: string;
  bannerClass: string;
}

export interface DiagnosisIssue {
  title: string;
  severity: 'hoch' | 'mittel' | 'keine' | string;
  description: string;
}

export interface DiagnosisResult {
  plantIdentified: string;
  vitalityScore: number;
  diagnosisSummary: string;
  issues: DiagnosisIssue[];
  immediateAction: string;
  isDemo?: boolean;
}

/**
 * Automatische Client-Side Bildkomprimierung mit HTML5 Canvas
 * - Skaliert Bilder mit max. Dimension (Breite oder Höhe) von maxWidth (Standard: 1080px) proportional
 * - Exportiert via canvas.toDataURL('image/jpeg', quality)
 */
export async function compressImage(
  file: File,
  maxWidth = 1080,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Fehler beim Lesen der Bilddatei'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Fehler beim Laden des Bildes in HTMLImageElement'));
      img.onload = () => {
        try {
          let { width, height } = img;

          // Proportional skalieren, falls Breite oder Höhe größer als maxWidth sind
          if (width > maxWidth || height > maxWidth) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxWidth) / height);
              height = maxWidth;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas 2D Context nicht verfügbar');
          }

          // Bild auf das Canvas zeichnen
          ctx.drawImage(img, 0, 0, width, height);

          // Als JPEG mit Qualität komprimieren
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch helper with strict timeout to prevent hanging network calls in sandboxes
 */
async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Botanische Dormanz- & Pflegelogik
 */
export function getDormancyStatus(
  species: string,
  temperature: number | null | undefined
): DormancyEvaluation {
  const lower = (species || '').toLowerCase();

  // Drosera capensis (Sonnentau) - Immer subtropischer Status
  if (lower.includes('drosera') || lower.includes('sonnentau') || lower.includes('capensis')) {
    return {
      statusType: 'SUBTROPICAL',
      badgeLabel: 'Subtropisch',
      badgeClass: 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)] border border-[var(--md-sys-color-outline-variant)]',
      dotClass: 'bg-[var(--md-sys-color-primary)] w-2 h-2 rounded-full',
      bannerText: '🌿 Subtropisch: Keine Winterruhe. Ganzjährig hell & warm halten.',
      bannerClass: 'bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)]',
    };
  }

  // Dionaea muscipula ODER Sarracenia
  const isTemperate =
    lower.includes('dionaea') ||
    lower.includes('fliegenfalle') ||
    lower.includes('venus') ||
    lower.includes('sarracenia') ||
    lower.includes('schlauch');

  const effectiveTemp = typeof temperature === 'number' ? temperature : 12;

  if (isTemperate) {
    if (effectiveTemp < 10) {
      return {
        statusType: 'DORMANZ_ACTIVE',
        badgeLabel: 'Winterruhe aktiv',
        badgeClass: 'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] border border-[#855300]/25',
        dotClass: 'bg-[var(--md-sys-color-tertiary)] w-2 h-2 rounded-full',
        bannerText: '❄️ Winterruhe aktiv (<10°C): Anstau stoppen & leicht feucht halten.',
        bannerClass: 'bg-[var(--md-sys-color-tertiary-container)] border border-[#855300]/25 text-[var(--md-sys-color-on-tertiary-container)]',
      };
    } else {
      return {
        statusType: 'GROWTH_ACTIVE',
        badgeLabel: 'Wachstumsphase',
        badgeClass: 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] border border-[#02432E]/20',
        dotClass: 'bg-[var(--md-sys-color-primary)] animate-pulse w-2 h-2 rounded-full',
        bannerText: '☀️ Wachstumsphase: Volle Sonne & hohes Anstauwasser.',
        bannerClass: 'bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 text-[var(--md-sys-color-on-primary-container)]',
      };
    }
  }

  if (effectiveTemp < 10) {
    return {
      statusType: 'DORMANZ_ACTIVE',
      badgeLabel: 'Kühlphase (<10°C)',
      badgeClass: 'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] border border-[#855300]/25',
      dotClass: 'bg-[var(--md-sys-color-tertiary)] w-2 h-2 rounded-full',
      bannerText: '❄️ Kühle Umgebung: Anstau reduzieren & Schimmelbildung vorbeugen.',
      bannerClass: 'bg-[var(--md-sys-color-tertiary-container)] border border-[#855300]/25 text-[var(--md-sys-color-on-tertiary-container)]',
    };
  }

  return {
    statusType: 'GROWTH_ACTIVE',
    badgeLabel: 'Aktiv',
    badgeClass: 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] border border-[#02432E]/20',
    dotClass: 'bg-[var(--md-sys-color-primary)] animate-pulse w-2 h-2 rounded-full',
    bannerText: '☀️ Wachstumsphase: Volle Sonne & ausreichend kalkfreies Wasser.',
    bannerClass: 'bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 text-[var(--md-sys-color-on-primary-container)]',
  };
}

/**
 * Maßgeschneiderte Vektor-Icons für karnivore Pflanzengattungen
 * 1. Dionaea muscipula: Klappfalle / Snap-Trap mit gezackten Fangzähnen
 * 2. Drosera capensis: Klebefalle / Sonnentau-Drüsen mit Tautropfen-Tentakeln
 * 3. Sarracenia: Schlauchfalle / Trichterkrug mit Haube (Operculum)
 * 4. Sonstige/Unbekannt: Botanisches Blatt-Icon
 */
export function SpeciesIcon({
  species,
  className = 'w-5 h-5',
}: {
  species?: string;
  className?: string;
}) {
  const lower = (species || '').toLowerCase();

  // 1. Dionaea muscipula (Klappfalle)
  if (lower.includes('dionaea') || lower.includes('fliegenfalle') || lower.includes('venus')) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {/* Oberer Fallenflügel */}
        <path d="M4 13.5c0-4.5 3.5-7.5 8-7.5s8 3 8 7.5" />
        {/* Randständige Fangzähne (Cilia) */}
        <path d="M5.5 12l1.5-2.5 1.5 2.5 1.5-2.5 1.5 2.5 1.5-2.5 1.5 2.5 1.5-2.5 1.5 2.5" />
        {/* Unterer Fallenflügel & Gelenk */}
        <path d="M4 14.5c0 3 3.5 5 8 5s8-2 8-5" />
        {/* Blattstiel */}
        <path d="M12 19.5v3" />
        {/* Fühlborsten / Triggerhaare */}
        <circle cx="9.5" cy="14.5" r="0.75" fill="currentColor" />
        <circle cx="14.5" cy="14.5" r="0.75" fill="currentColor" />
      </svg>
    );
  }

  // 2. Drosera capensis (Klebefalle / Sonnentau)
  if (lower.includes('drosera') || lower.includes('sonnentau') || lower.includes('capensis')) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {/* Sonnentau-Blatt & Tentakeln */}
        <path d="M12 22V7c0-2.5 2-4.5 4.5-4.5S21 4.5 21 7c0 4-3.5 7-9 9" />
        {/* Klebrige Tautropfen an den Tentakelspitzen */}
        <circle cx="6" cy="6" r="1.5" fill="currentColor" />
        <path d="M12 9H7.5" />
        <circle cx="5" cy="11.5" r="1.5" fill="currentColor" />
        <path d="M12 12H6.5" />
        <circle cx="6" cy="16.5" r="1.5" fill="currentColor" />
        <path d="M12 15H7.5" />
        <circle cx="18" cy="13.5" r="1.5" fill="currentColor" />
        <path d="M12 14h4.5" />
        <circle cx="19" cy="9" r="1.5" fill="currentColor" />
        <circle cx="16.5" cy="2.5" r="1.5" fill="currentColor" />
      </svg>
    );
  }

  // 3. Sarracenia (Schlauchfalle)
  if (lower.includes('sarracenia') || lower.includes('schlauch')) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {/* Schlauchfalle Trichter */}
        <path d="M14.5 21l1.5-12c.5-2.5 1-3.5 1.5-4.5-1-1-3.5-1.5-6-1.5-3 0-5.5 1-6 2.5 1 2 2.5 4 3 6l1.5 9.5" />
        {/* Überhängender Deckel (Operculum) */}
        <path d="M8.5 7.5C9 5.5 11 4.5 14 5c2 .3 3.5 1.5 4 3" />
        {/* Krugöffnung / Peristom */}
        <ellipse cx="13" cy="8" rx="4" ry="1.5" />
        {/* Basis */}
        <path d="M8 21h8" />
      </svg>
    );
  }

  // 4. Fallback für alle übrigen Arten
  return <Leaf className={className} aria-hidden="true" />;
}

/**
 * Struktureller M3-Skeleton-Platzhalter für Pflanzenkarten
 * Radius 28px (var(--md-sys-shape-corner-extra-large)) & Tonal Elevation
 */
export function PlantCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="m3-plant-card rounded-[28px] p-4 bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] flex flex-col gap-3 animate-pulse"
    >
      {/* Upper Section */}
      <div className="flex items-start justify-between gap-3">
        {/* Avatar Box Placeholder (Sub-Tile lowest surface #FFFFFF) */}
        <div className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] shrink-0" />

        {/* Text & Badge Columns */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            {/* Title Placeholder */}
            <div className="h-4.5 w-32 bg-[var(--md-sys-color-surface-container-highest)] rounded-md" />
            {/* Action Placeholder */}
            <div className="w-5 h-5 rounded-lg bg-[var(--md-sys-color-surface-container-highest)] shrink-0" />
          </div>

          {/* Species Placeholder */}
          <div className="h-3 w-40 bg-[var(--md-sys-color-surface-container-highest)] rounded-md mt-1.5" />

          {/* Badges Row Placeholder */}
          <div className="flex items-center gap-2 mt-2">
            <div className="h-5 w-28 bg-[var(--md-sys-color-surface-container-highest)] rounded-full" />
            <div className="w-16 h-4 bg-[var(--md-sys-color-surface-container-highest)] rounded" />
          </div>
        </div>
      </div>

      {/* Bottom Bar Placeholder */}
      <div className="pt-2 border-t border-[var(--md-sys-color-outline-variant)] flex items-center justify-between">
        <div className="h-3.5 w-24 bg-[var(--md-sys-color-surface-container-highest)] rounded-md" />
        <div className="h-3.5 w-20 bg-[var(--md-sys-color-surface-container-highest)] rounded-md" />
      </div>
    </article>
  );
}

export type HapticType = 'subtle' | 'success' | 'warning';

/**
 * Mikro-haptisches Vibrations-Feedback über die native HTML5 Web Vibration API
 * Sichere Prüfung auf Browser-Unterstützung vor jedem Aufruf.
 */
export function triggerHaptic(type: HapticType): void {
  if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in window.navigator) {
    try {
      if (type === 'subtle') {
        window.navigator.vibrate(10);
      } else if (type === 'success') {
        window.navigator.vibrate([15, 30, 15]);
      } else if (type === 'warning') {
        window.navigator.vibrate(35);
      }
    } catch {
      // Ignoriere Restriktionen in Test- oder iFrame-Umgebungen
    }
  }
}

export const SPECIES_OPTIONS = [
  {
    value: 'Dionaea muscipula (Venusfliegenfalle)',
    name: 'Dionaea muscipula',
    trapType: 'Klappfalle',
    description: 'Schnappfalle mit Sensorhaaren',
  },
  {
    value: 'Drosera capensis (Sonnentau)',
    name: 'Drosera capensis',
    trapType: 'Klebefalle',
    description: 'Tau-Drüsen mit Klebetropfen',
  },
  {
    value: 'Sarracenia (Schlauchpflanze)',
    name: 'Sarracenia',
    trapType: 'Schlauchfalle',
    description: 'Trichterkrug mit Gleitzone',
  },
];

/**
 * Gieß-Tracker Status & relative Datums-Berechnung
 * - 0 bis 3 Tage: "💧 Anstau optimal (Vor X Tagen gegossen)"
 * - 4 bis 7 Tage: "⚠️ Wasserstand prüfen"
 * - Über 7 Tage: "🚨 Anstau auffüllen (Destilliert-/Regenwasser)"
 */
export function getWateringStatus(lastWateredAt?: Timestamp | null): {
  days: number;
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  if (!lastWateredAt) {
    return {
      days: 99,
      label: '🚨 Anstau auffüllen (Destilliert-/Regenwasser)',
      badgeClass: 'bg-[#FFDAD6] text-[#410002] border border-[#BA1A1A]/30',
      dotClass: 'bg-[#BA1A1A]',
    };
  }

  const dateMs = typeof lastWateredAt.toMillis === 'function'
    ? lastWateredAt.toMillis()
    : ((lastWateredAt as any).seconds ? (lastWateredAt as any).seconds * 1000 : Date.now());
  const now = Date.now();
  const days = Math.floor(Math.max(0, now - dateMs) / (1000 * 60 * 60 * 24));

  if (days <= 3) {
    return {
      days,
      label: `💧 Anstau optimal (Vor ${days} ${days === 1 ? 'Tag' : 'Tagen'} gegossen)`,
      badgeClass: 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] border border-[#02432E]/20',
      dotClass: 'bg-[var(--md-sys-color-primary)]',
    };
  }

  if (days <= 7) {
    return {
      days,
      label: '⚠️ Wasserstand prüfen',
      badgeClass: 'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] border border-[#855300]/25',
      dotClass: 'bg-[var(--md-sys-color-tertiary)]',
    };
  }

  return {
    days,
    label: '🚨 Anstau auffüllen (Destilliert-/Regenwasser)',
    badgeClass: 'bg-[#FFDAD6] text-[#410002] border border-[#BA1A1A]/30',
    dotClass: 'bg-[#BA1A1A]',
  };
}

/**
 * Botanische Detail-Informationen für das Detail-Overlay
 */
export function getSpeciesDetails(speciesName: string) {
  const lower = (speciesName || '').toLowerCase();
  if (lower.includes('dionaea') || lower.includes('fliegenfalle') || lower.includes('venus')) {
    return {
      trapName: 'Klappfalle',
      trapDetail: 'Bivalve Fangblätter mit schnellem Schnappmechanismus (<100 ms). Schließt durch Reizung zweier Fühlborsten.',
      substrate: 'Ungedüngter Hochmoor-Weißtorf gemischt mit Quarzsand oder Perlit (2:1).',
      light: 'Vollsonnig (Südfenster oder Freiland von April bis Oktober, mind. 6 Std. direkte Sonne täglich).',
      resting: 'Benötigt zwingend eine 3–4-monatige kühle Winterruhe bei 0–10 °C.',
    };
  }
  if (lower.includes('drosera') || lower.includes('sonnentau') || lower.includes('capensis')) {
    return {
      trapName: 'Klebefalle',
      trapDetail: 'Drüsententakeln scheiden klebrige, enzymhaltige Tautropfen ab und rollen sich aktiv um die Beute.',
      substrate: 'Karnivorenerde (Weißtorf mit Quarzsand 2:1), durchgehend feucht bis nass.',
      light: 'Sehr hell bis sonnig; verträgt auch ganzjährig einen hellen Fensterplatz.',
      resting: 'Subtropisch; benötigt keine Frostperiode, toleriert aber kühle Temperaturen (5–15 °C) problemlos.',
    };
  }
  if (lower.includes('sarracenia') || lower.includes('schlauch')) {
    return {
      trapName: 'Schlauchfalle',
      trapDetail: 'Aufrechte Trichterkrüge mit glatter Gleitzone und nach unten gerichteten Sperrhaaren.',
      substrate: 'Nasser Torf-Sand-Mix (1:1), dauerhaft hoher Anstau während des Sommers.',
      light: 'Maximale Sonne für kräftige Anthocyan-Ausfärbung und feste Krüge.',
      resting: 'Winterhart oder frostfrei kühl überwintern bei 0–8 °C; Anstau im Winter leicht reduzieren.',
    };
  }
  return {
    trapName: 'Karnivore Falle',
    trapDetail: 'Spezialisierte Blattbildung zum Fang von Kleininsekten zur Nährstoffaufnahme in nährstoffarmen Böden.',
    substrate: 'Kalkfreies, ungedüngtes Moortorf-Gemisch mit Quarzsand.',
    light: 'Sehr sonnig und hell.',
    resting: 'Je nach Herkunft kühl oder gemäßigt temperiert.',
  };
}

/**
 * Botanische Pflegesteckbrief-Garantie
 * - Dionaea/Sarracenia: "Sonne: Volle Sonne (10.000+ Lux) | Wasser: Destilliert/Regenwasser (TDS < 50 ppm) | Substrat: Weisstorf/Perlite (2:1)"
 * - Drosera capensis: "Sonne: Hell bis sonnig | Wasser: Ganzjährig Anstau | Substrat: Ungedüngter Torf"
 */
export function getCareGuarantee(species: string): {
  guaranteeText: string;
  sun: string;
  water: string;
  substrate: string;
} {
  const s = (species || '').toLowerCase();
  if (
    s.includes('dionaea') ||
    s.includes('venus') ||
    s.includes('sarracenia') ||
    s.includes('schlauch')
  ) {
    return {
      guaranteeText:
        'Sonne: Volle Sonne (10.000+ Lux) | Wasser: Destilliert/Regenwasser (TDS < 50 ppm) | Substrat: Weisstorf/Perlite (2:1)',
      sun: 'Volle Sonne (10.000+ Lux)',
      water: 'Destilliert/Regenwasser (TDS < 50 ppm)',
      substrate: 'Weisstorf/Perlite (2:1)',
    };
  }

  if (s.includes('drosera') || s.includes('sonnentau')) {
    return {
      guaranteeText:
        'Sonne: Hell bis sonnig | Wasser: Ganzjährig Anstau | Substrat: Ungedüngter Torf',
      sun: 'Hell bis sonnig',
      water: 'Ganzjährig Anstau',
      substrate: 'Ungedüngter Torf',
    };
  }

  return {
    guaranteeText:
      'Sonne: Sehr hell bis sonnig (8.000+ Lux) | Wasser: Kalkfrei Anstau (TDS < 50 ppm) | Substrat: Karnivoren-Weißtorf ungedüngt',
    sun: 'Sehr hell bis sonnig (8.000+ Lux)',
    water: 'Kalkfrei Anstau (TDS < 50 ppm)',
    substrate: 'Karnivoren-Weißtorf ungedüngt',
  };
}

/**
 * Nachbar-Guide: Verträgliche Begleiter & Moorbeet-Kompatibilität
 * - Für Dionaea/Sarracenia: "Gute Nachbarn: Drosera (gemäßigt), Sarracenia, Pogonia (Moorbeet-Gemeinschaft)."
 * - Für Nepenthes: "Gute Nachbarn: Pinguicula (tropisch), Orchideen. Nicht für Freiland-Moorbeete geeignet."
 */
export function getCompanionPlantGuide(species: string): {
  headline: string;
  recommendation: string;
  warningNote?: string;
} {
  const s = (species || '').toLowerCase();
  if (s.includes('nepenthes') || s.includes('kannen')) {
    return {
      headline: 'Tropische Gemeinschaft',
      recommendation: 'Gute Nachbarn: Pinguicula (tropisch), Orchideen. Nicht für Freiland-Moorbeete geeignet.',
      warningNote: 'Nepenthes hat abweichende Licht- und Wasserbedürfnisse. Halte sie nicht im selben Anstau-Untersetzer wie Dionaea oder Sarracenia!',
    };
  }

  if (
    s.includes('dionaea') ||
    s.includes('venus') ||
    s.includes('sarracenia') ||
    s.includes('schlauch')
  ) {
    return {
      headline: 'Moorbeet-Gemeinschaft',
      recommendation: 'Gute Nachbarn: Drosera (gemäßigt), Sarracenia, Pogonia (Moorbeet-Gemeinschaft).',
      warningNote: 'Nicht im selben Anstau mit Kannenpflanzen (Nepenthes) halten – diese ersticken im Daueranstau.',
    };
  }

  if (s.includes('drosera') || s.includes('sonnentau')) {
    return {
      headline: 'Moorbeet-Gemeinschaft',
      recommendation: 'Gute Nachbarn: Drosera (gemäßigt), Sarracenia, Pogonia (Moorbeet-Gemeinschaft).',
      warningNote: 'Verträgt sich ideal mit Dionaea und Sarracenia im sonnigen Torf-Anstau.',
    };
  }

  return {
    headline: 'Verträgliche Begleiter',
    recommendation: 'Gute Nachbarn: Drosera (gemäßigt), Sarracenia, Pogonia (Moorbeet-Gemeinschaft).',
  };
}

/**
 * Prüft Inkompatibilität von Pflanzenarten:
 * Regel: "Nepenthes" (Kannenpflanze) verträgt keine direkte Prallsonne, keine kalte Überwinterung
 * und keine dauerhafte Staunässe, während "Dionaea muscipula" und "Sarracenia" volle Prallsonne,
 * Anstauwasser und kalte Winterruhe benötigen.
 */
export function checkPlantIncompatibility(newSpecies: string, existingPlants: { species: string }[]): boolean {
  const sLower = (newSpecies || '').toLowerCase();
  const isNewNepenthes = sLower.includes('nepenthes') || sLower.includes('kannen');
  const isNewMoor = sLower.includes('dionaea') || sLower.includes('venus') || sLower.includes('sarracenia') || sLower.includes('schlauch');

  if (!isNewNepenthes && !isNewMoor) return false;

  const hasExistingMoor = existingPlants.some((p) => {
    const s = (p.species || '').toLowerCase();
    return s.includes('dionaea') || s.includes('venus') || s.includes('sarracenia') || s.includes('schlauch');
  });

  const hasExistingNepenthes = existingPlants.some((p) => {
    const s = (p.species || '').toLowerCase();
    return s.includes('nepenthes') || s.includes('kannen');
  });

  return (isNewNepenthes && hasExistingMoor) || (isNewMoor && hasExistingNepenthes);
}

export function formatHistoryTimestamp(
  ts?: Timestamp | { seconds: number; nanoseconds?: number } | null
): string {
  if (!ts) return 'Unbekannter Zeitpunkt';
  try {
    const millis =
      typeof (ts as any).toMillis === 'function'
        ? (ts as any).toMillis()
        : typeof (ts as any).seconds === 'number'
        ? (ts as any).seconds * 1000
        : Date.now();
    const date = new Date(millis);
    const now = new Date();

    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
      return `Heute, ${timeStr} Uhr`;
    }
    if (isYesterday) {
      return `Gestern, ${timeStr} Uhr`;
    }
    return `${date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })}, ${timeStr} Uhr`;
  } catch {
    return 'Gieß-Eintrag';
  }
}

/**
 * Berechnet das verbleibende Spül-Intervall in Tagen (standardmäßig alle 30 Tage)
 */
export function getSubstrateRinseDays(
  createdAt?: Timestamp | { seconds: number; nanoseconds?: number } | string | null,
  id: string = ''
): number {
  const now = Date.now();
  let createdMs = now;
  if (createdAt && typeof (createdAt as any).toMillis === 'function') {
    createdMs = (createdAt as any).toMillis();
  } else if (createdAt && typeof (createdAt as any).seconds === 'number') {
    createdMs = (createdAt as any).seconds * 1000;
  } else if (typeof createdAt === 'string') {
    const parsed = new Date(createdAt).getTime();
    if (!isNaN(parsed)) createdMs = parsed;
  } else {
    const seed = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return (seed % 28) + 1;
  }
  const daysPassed = Math.max(0, Math.floor((now - createdMs) / (1000 * 60 * 60 * 24)));
  const cycleDays = 30;
  const remaining = cycleDays - (daysPassed % cycleDays);
  return remaining === 0 ? cycleDays : remaining;
}

export default function App() {
  // Global Firebase Auth State (Sub-Step 7.1.1 & 7.1.3)
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Sub-Step 7.3.1: Auth Modal Form States
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState<boolean>(false);
  const [showSwitchAccount, setShowSwitchAccount] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'plants' | 'scanner' | 'settings'>('plants');
  const [plants, setPlants] = useState<PlantDoc[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSpeciesDropdownOpen, setIsSpeciesDropdownOpen] = useState(false);
  
  // Detail Bottom-Sheet ("Pflanzen-Akte") State
  const [selectedPlant, setSelectedPlant] = useState<PlantDoc | null>(null);
  const activeDetailPlant = selectedPlant
    ? plants.find((p) => p.id === selectedPlant.id) || selectedPlant
    : null;

  // Settings & Tools Tab States
  const [substrateRinseReminder, setSubstrateRinseReminder] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('carnivora_substrate_rinse_reminder');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [settingsSubView, setSettingsSubView] = useState<'main' | 'water_calc' | 'substrate_calc' | 'pest_guide'>('main');

  // Sub-Tool 1: Wasser- & TDS-Rechner State
  const [tdsInput, setTdsInput] = useState<number>(25);
  const [targetTds, setTargetTds] = useState<number>(35);
  const [tapTds, setTapTds] = useState<number>(280);
  const [pureWaterTds, setPureWaterTds] = useState<number>(5);
  const [totalWaterLiters, setTotalWaterLiters] = useState<number>(5);

  // Sub-Tool 2: Substrat-Rechner State
  const [substrateProfile, setSubstrateProfile] = useState<'classic' | 'nepenthes' | 'drosera'>('classic');
  const [substrateVolume, setSubstrateVolume] = useState<number>(3);

  // Sub-Tool 3: Fütterungs- & Schädlings-Guide State
  const [guideTab, setGuideTab] = useState<'feeding' | 'pests'>('feeding');

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toast helper (auto fade-out after 2.5 seconds)
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  // Delete-Safety: Store ID of plant pending confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Gieß-Tracker: ID der Pflanze, die gerade als gegossen gespeichert wird
  const [isWateringId, setIsWateringId] = useState<string | null>(null);

  // Weather State Map: zipCode -> WeatherData
  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});

  // Scanner Tab States
  const [scannerImage, setScannerImage] = useState<string | null>(null);
  const [scannerMimeType, setScannerMimeType] = useState<string>('image/jpeg');
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);

  // Scanner Zuordnung zur Pflanzen-Akte
  const [selectedPlantForScanId, setSelectedPlantForScanId] = useState<string>('');
  const [isSavingScanToPlant, setIsSavingScanToPlant] = useState<boolean>(false);
  const [isScanSaved, setIsScanSaved] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const plantsUnsubscribeRef = useRef<(() => void) | null>(null);
  const previousUidRef = useRef<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    species: 'Dionaea muscipula (Venusfliegenfalle)',
    zipCode: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [incompatibilityWarning, setIncompatibilityWarning] = useState<string | null>(null);
  const [isSavedWithWarning, setIsSavedWithWarning] = useState<boolean>(false);

  // Echtzeit-PLZ-Validierungsstatus
  const [zipValidation, setZipValidation] = useState<ZipValidationState>({
    status: 'idle',
  });

  // PWA Installation & Standalone Detection State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [dismissedInstallBanner, setDismissedInstallBanner] = useState<boolean>(false);

  // Accessible unique IDs
  const nameInputId = useId();
  const speciesSelectId = useId();
  const zipCodeInputId = useId();

  // Register auth state listener & automatic anonymous guest login (Sub-Step 7.1.2)
  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      if (!user) {
        // Sub-Step 7.4.2: Bereinige den aktiven Firestore-Listener und den lokalen Zustand sofort
        if (plantsUnsubscribeRef.current) {
          plantsUnsubscribeRef.current();
          plantsUnsubscribeRef.current = null;
        }
        previousUidRef.current = null;
        setCurrentUser(null);
        setPlants([]);
        setSelectedPlant(null);
        setSelectedPlantForScanId('');
        setConfirmDeleteId(null);
        setIsLoading(true);

        // 1. AUTOMATISCHER ANONYMER LOGIN-CHECK:
        // Sobald die App lädt und kein User eingeloggt ist, löse im Hintergrund signInAnonymously() aus
        try {
          await signInAnonymously(auth);
          // onAuthStateChanged löst danach unmittelbar erneut mit dem neuen anonymen User aus
        } catch (authError) {
          console.error('Anonymous auth error:', authError);
          if (isMounted) {
            setIsAuthLoading(false);
            showToast('⚠️ Gast-Sitzung konnte nicht gestartet werden. Bitte Seite neu laden.');
          }
        }
        return;
      }

      // Sub-Step 7.4.2: Harter State-Reset bei Wechsel auf ein anderes Benutzerkonto
      if (previousUidRef.current && previousUidRef.current !== user.uid) {
        if (plantsUnsubscribeRef.current) {
          plantsUnsubscribeRef.current();
          plantsUnsubscribeRef.current = null;
        }
        setPlants([]);
        setSelectedPlant(null);
        setSelectedPlantForScanId('');
        setConfirmDeleteId(null);
        setIsLoading(true);
      }
      previousUidRef.current = user.uid;

      // 2. USER-PROFIL-DOKUMENT ERSTELLEN (Firestore):
      // Speichere das User-Objekt im zentralen State
      setCurrentUser(user);

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) {
          // Neues Gast-Profil anlegen mit Standardeinstellungen
          await setDoc(
            userDocRef,
            {
              isAnonymous: true,
              createdAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
              preferences: {
                spuelErinnerungActive: true,
              },
            },
            { merge: true }
          );
          if (isMounted) {
            setSubstrateRinseReminder(true);
            try {
              localStorage.setItem('carnivora_substrate_rinse_reminder', JSON.stringify(true));
            } catch {}
          }
        } else {
          // Vorhandenes Profil aktualisieren (lastLoginAt & Auth-Status)
          await setDoc(
            userDocRef,
            {
              isAnonymous: Boolean(user.isAnonymous),
              ...(user.email ? { email: user.email } : {}),
              lastLoginAt: serverTimestamp(),
            },
            { merge: true }
          );

          // Sub-Step 7.2.3: Einstellungen beim App-Start aus users/{currentUser.uid} laden
          const data = userSnap.data();
          const savedActive = data?.preferences?.spuelErinnerungActive;
          const isActive = typeof savedActive === 'boolean' ? savedActive : true;
          if (isMounted) {
            setSubstrateRinseReminder(isActive);
            try {
              localStorage.setItem('carnivora_substrate_rinse_reminder', JSON.stringify(isActive));
            } catch {}
          }
        }
      } catch (profileError) {
        console.warn('User profile sync notice:', profileError);
        handleFirestoreError(profileError, OperationType.WRITE, `users/${user.uid}`);
      } finally {
        if (isMounted) {
          setIsAuthLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [showToast]);

  // Test connection on mount
  useEffect(() => {
    testFirestoreConnection();
  }, []);

  // PWA Manifest Verification & beforeinstallprompt Interception
  useEffect(() => {
    // 1. Dynamic Web App Manifest Injection if missing in DOM
    if (typeof document !== 'undefined') {
      let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      if (!manifestLink) {
        manifestLink = document.createElement('link');
        manifestLink.rel = 'manifest';
        manifestLink.href = '/manifest.json';
        document.head.appendChild(manifestLink);
      }
    }

    // 2. Standalone Mode Erkennung (bereits als PWA auf Homescreen installiert)
    if (typeof window !== 'undefined') {
      const checkStandalone = () => {
        const isDisplayStandalone = window.matchMedia('(display-mode: standalone)').matches;
        const isNavStandalone = (window.navigator as any).standalone === true;
        return isDisplayStandalone || isNavStandalone;
      };
      setIsStandalone(checkStandalone());
    }

    // 3. Native Install Prompt Interception
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setDismissedInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Automatische Vorauswahl der ersten Pflanze im Dropdown des KI-Scanners
  useEffect(() => {
    if (!selectedPlantForScanId && plants.length > 0) {
      setSelectedPlantForScanId(plants[0].id);
    }
  }, [plants, selectedPlantForScanId]);

  // Modal & Detail Bottom-Sheet ("Pflanzen-Akte") ESC Key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAuthModalOpen) {
          triggerHaptic('subtle');
          setIsAuthModalOpen(false);
        } else if (selectedPlant) {
          triggerHaptic('subtle');
          setSelectedPlant(null);
        } else if (isModalOpen) {
          triggerHaptic('subtle');
          setIsModalOpen(false);
          setIsSpeciesDropdownOpen(false);
          setFormError(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthModalOpen, isModalOpen, selectedPlant]);

  // Sub-Step 7.2.3: EINSTELLUNGEN BEIM APP-START / USER-WECHSEL LADEN
  useEffect(() => {
    if (!currentUser?.uid) return;
    let isCancelled = false;

    const loadUserPreferences = async () => {
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists() && !isCancelled) {
          const data = userSnap.data();
          const savedActive = data?.preferences?.spuelErinnerungActive;
          // Fallback-Logik: Falls das Feld preferences.spuelErinnerungActive im Dokument noch nicht existiert, nutze standardmäßig true
          const isActive = typeof savedActive === 'boolean' ? savedActive : true;
          setSubstrateRinseReminder(isActive);
          try {
            localStorage.setItem('carnivora_substrate_rinse_reminder', JSON.stringify(isActive));
          } catch {}
        }
      } catch (err) {
        console.warn('Error loading user preferences:', err);
      }
    };

    loadUserPreferences();

    return () => {
      isCancelled = true;
    };
  }, [currentUser?.uid]);

  // Sub-Step 7.2.3: PREFERENCES-PERSISTENZ IN FIRESTORE & TOAST-FEEDBACK
  const handleToggleSubstrateReminder = async () => {
    triggerHaptic('subtle');
    const next = !substrateRinseReminder;
    setSubstrateRinseReminder(next);

    try {
      localStorage.setItem('carnivora_substrate_rinse_reminder', JSON.stringify(next));
    } catch {}

    if (currentUser?.uid) {
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await setDoc(
          userDocRef,
          {
            preferences: {
              spuelErinnerungActive: next,
            },
          },
          { merge: true }
        );
        showToast('Einstellungen gespeichert');
      } catch (err) {
        console.error('Error saving user preferences to Firestore:', err);
        handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
        showToast('Fehler beim Speichern der Einstellungen');
      }
    } else {
      showToast('Einstellungen gespeichert');
    }
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Auto-reset delete confirmation after 4 seconds
  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => {
      setConfirmDeleteId(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  // 1. Debounced API-Check für Postleitzahl (400ms Entprellung)
  useEffect(() => {
    const cleanZip = formData.zipCode.trim();

    if (!cleanZip) {
      setZipValidation({ status: 'idle' });
      return;
    }

    // Wenn noch nicht genau 5 Ziffern
    if (!/^\d{5}$/.test(cleanZip)) {
      if (cleanZip.length >= 5) {
        setZipValidation({ status: 'invalid' });
      } else {
        setZipValidation({ status: 'idle' });
      }
      return;
    }

    // Genau 5 Ziffern -> Ladezustand & 400ms Debounce
    setZipValidation({ status: 'loading' });

    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(
          `https://api.zippopotam.us/de/${encodeURIComponent(cleanZip)}`,
          3500
        );
        if (res.ok) {
          const data = await res.json();
          if (data.places && data.places.length > 0) {
            const place = data.places[0];
            const cityName = place['place name'] || '';
            const rawState = place['state abbreviation'] || place['state'] || '';
            const stateCode = rawState === 'NW' ? 'NRW' : rawState;
            setZipValidation({
              status: 'valid',
              city: cityName,
              stateCode: stateCode,
            });

            // Cache für nachfolgende Dashboard-Anzeige vorab befüllen
            weatherCache.set(cleanZip, {
              temperature: 12,
              cityName,
              isFallback: false,
              timestamp: Date.now(),
            });
            return;
          }
        }
        setZipValidation({ status: 'invalid' });
      } catch (err) {
        console.warn('PLZ-Validierung fehlgeschlagen:', err);
        setZipValidation({ status: 'invalid' });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [formData.zipCode]);

  /**
   * Robuste Geocoding- & Wetter-Abfrage mit 15-Minuten-Cache-TTL
   */
  const fetchWeatherForZip = useCallback(async (zipCode: string, forceRefresh = false) => {
    const cleanZip = zipCode.trim();
    if (!cleanZip) return;

    if (!forceRefresh && weatherCache.has(cleanZip)) {
      const cached = weatherCache.get(cleanZip)!;
      // Gültigkeit prüfen: Wenn jünger als 15 Minuten, Cache-Wert nutzen
      if (Date.now() - cached.timestamp < WEATHER_CACHE_TTL_MS) {
        setWeatherMap((prev) => ({
          ...prev,
          [cleanZip]: {
            temperature: cached.temperature,
            cityName: cached.cityName,
            loading: false,
            error: false,
            isFallback: cached.isFallback,
          },
        }));
        return;
      }
    }

    setWeatherMap((prev) => ({
      ...prev,
      [cleanZip]: {
        temperature: prev[cleanZip]?.temperature ?? 12,
        cityName: prev[cleanZip]?.cityName,
        loading: true,
        error: false,
      },
    }));

    let latitude: number | null = null;
    let longitude: number | null = null;
    let resolvedCity: string | undefined = undefined;

    try {
      // 1. Zippopotam.us DE
      try {
        const zippoRes = await fetchWithTimeout(
          `https://api.zippopotam.us/de/${encodeURIComponent(cleanZip)}`,
          3000
        );
        if (zippoRes.ok) {
          const zippoData = await zippoRes.json();
          if (zippoData.places && zippoData.places.length > 0) {
            const place = zippoData.places[0];
            const parsedLat = parseFloat(place.latitude);
            const parsedLon = parseFloat(place.longitude);
            if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
              latitude = parsedLat;
              longitude = parsedLon;
              resolvedCity = place['place name'] || undefined;
            }
          }
        }
      } catch (zippoErr) {
        console.warn(`Zippopotam.us nicht erreichbar für ${cleanZip}:`, zippoErr);
      }

      // 2. Open-Meteo Geocoding Fallback
      if (latitude === null || longitude === null) {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          cleanZip
        )}&count=1&country_code=DE&language=de&format=json`;

        const geoRes = await fetchWithTimeout(geoUrl, 3000);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.results && geoData.results.length > 0) {
            latitude = geoData.results[0].latitude;
            longitude = geoData.results[0].longitude;
            resolvedCity = geoData.results[0].name || undefined;
          }
        }
      }

      // 3. Open-Meteo Forecast
      if (latitude !== null && longitude !== null) {
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
        const weatherRes = await fetchWithTimeout(forecastUrl, 3000);

        if (weatherRes.ok) {
          const weatherData = await weatherRes.json();
          if (
            weatherData.current_weather &&
            typeof weatherData.current_weather.temperature === 'number'
          ) {
            const liveTemp = weatherData.current_weather.temperature;

            weatherCache.set(cleanZip, {
              temperature: liveTemp,
              cityName: resolvedCity,
              isFallback: false,
              timestamp: Date.now(),
            });

            setWeatherMap((prev) => ({
              ...prev,
              [cleanZip]: {
                temperature: liveTemp,
                cityName: resolvedCity,
                loading: false,
                error: false,
                isFallback: false,
              },
            }));
            return;
          }
        }
      }

      throw new Error('Keine Wetterdaten für PLZ erhalten');
    } catch (err) {
      console.warn(`Wetterabfrage für ${cleanZip} fehlgeschlagen. Nutze Sandbox-Fallback:`, err);

      const fallbackResult: WeatherData = {
        temperature: 12.0,
        cityName: resolvedCity || 'Standard',
        loading: false,
        error: false,
        isFallback: true,
      };

      weatherCache.set(cleanZip, {
        temperature: fallbackResult.temperature,
        cityName: fallbackResult.cityName,
        isFallback: true,
        timestamp: Date.now(),
      });

      setWeatherMap((prev) => ({
        ...prev,
        [cleanZip]: fallbackResult,
      }));
    }
  }, []);

  // Automatischer Hintergrund-Refresh der Wetterdaten alle 15 Minuten & bei Tab-Fokussierung
  useEffect(() => {
    const refreshStaleWeather = () => {
      const uniqueZips = Array.from(new Set(plants.map((p) => p.zipCode?.trim()))).filter(Boolean);
      if (uniqueZips.length === 0) return;

      uniqueZips.forEach((zip) => {
        const cached = weatherCache.get(zip);
        // Wenn Cache abgelaufen (>15 Minuten) oder noch nicht vorhanden: frisch abrufen
        if (!cached || Date.now() - cached.timestamp >= WEATHER_CACHE_TTL_MS) {
          fetchWeatherForZip(zip, true);
        }
      });
    };

    // 15-Minuten-Hintergrundintervall
    const interval = setInterval(refreshStaleWeather, WEATHER_CACHE_TTL_MS);

    // Bei Tab-Rückkehr prüfen, ob Daten älter als 15 Minuten sind
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshStaleWeather();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [plants, fetchWeatherForZip]);

  // READ (Echtzeit-Synchronisation via onSnapshot - Sub-Step 7.2.2 Multi-Tenancy & Sub-Step 7.4.2 Harter State-Reset)
  useEffect(() => {
    // Sub-Step 7.4.2: Harter State-Reset bei jedem Wechsel der currentUser.uid
    setPlants([]);
    setSelectedPlant(null);
    setSelectedPlantForScanId('');
    setConfirmDeleteId(null);
    setIsLoading(true);

    // 1. & 4. GUARD-CLAUSE FÜR NICHT-INITIALISIERTE SITZUNGEN:
    // Führe keine Datenbankschreib- oder -leseoperationen ohne valide currentUser.uid aus.
    if (
      !currentUser ||
      !currentUser.uid ||
      !auth.currentUser ||
      auth.currentUser.uid !== currentUser.uid
    ) {
      return;
    }

    let isSubscribed = true;

    // Subcollection: users/{currentUser.uid}/plants geordnet nach Erstellungsdatum
    const userPlantsCollectionRef = collection(db, 'users', currentUser.uid, 'plants');
    const q = query(userPlantsCollectionRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isSubscribed) return;
        const loadedPlants: PlantDoc[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || 'Unbenannt',
            species: data.species || 'Dionaea muscipula',
            zipCode: data.zipCode || '10115',
            isDormant: Boolean(data.isDormant),
            createdAt: data.createdAt as Timestamp,
            lastWateredAt: (data.lastWateredAt as Timestamp) || (data.createdAt as Timestamp) || null,
            wateringHistory: data.wateringHistory,
            diagnosisHistory: data.diagnosisHistory,
            scans: data.scans,
          };
        });
        setPlants(loadedPlants);
        setIsLoading(false);

        const uniqueZips = Array.from(new Set(loadedPlants.map((p) => p.zipCode.trim()))).filter(
          Boolean
        );
        uniqueZips.forEach((zip) => {
          fetchWeatherForZip(zip);
        });
      },
      (error: any) => {
        if (!isSubscribed) return;
        // Sub-Step 7.4.1: Clientseitiges Abfangen von Firestore Permission-Errors
        if (error?.code === 'permission-denied') {
          console.warn("Zugriff verweigert: Warten auf Auth-Token...");
          setIsLoading(false);
          return;
        }
        // Bei Abmeldung oder Nutzerwechsel das Token-Widerrufs-Event abfangen (kein Fehler)
        if (!auth.currentUser || auth.currentUser.uid !== currentUser.uid) {
          setIsLoading(false);
          return;
        }
        console.error('Firestore onSnapshot error: ', error);
        handleFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/plants`);
        setIsLoading(false);
        showToast('Fehler bei der Synchronisation');
      }
    );

    plantsUnsubscribeRef.current = unsubscribe;

    // Unsubscribe-Logik: Verhindert Memory-Leaks und verwaiste Event-Handler
    return () => {
      isSubscribed = false;
      plantsUnsubscribeRef.current = null;
      unsubscribe();
    };
  }, [currentUser?.uid, fetchWeatherForZip, showToast]);

  // Sub-Step 7.3.2: Firestore-Dokument aktualisieren (users/{uid})
  const updateUserProfileAfterAuth = async (user: User) => {
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(
        userDocRef,
        {
          isAnonymous: false,
          email: user.email || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('User profile sync notice after auth:', err);
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  // Sub-Step 7.3.2: Google Sign-In & Account Linking Handler (Sub-Step 7.3.2)
  const handleGoogleSignIn = async () => {
    setIsAuthSubmitting(true);
    setAuthError(null);
    triggerHaptic('subtle');

    const googleProvider = new GoogleAuthProvider();

    try {
      // 1. ACCOUNT-LINKING FÜR ANONYME GÄSTE:
      if (currentUser && currentUser.isAnonymous) {
        let linkedUser: User;
        if (typeof (currentUser as any).linkWithPopup === 'function') {
          const userCred = await (currentUser as any).linkWithPopup(googleProvider);
          linkedUser = userCred.user;
        } else {
          const userCred = await linkWithPopup(currentUser, googleProvider);
          linkedUser = userCred.user;
        }

        // 3. FIRESTORE-DOKUMENT UPDATE (users/{uid})
        await updateUserProfileAfterAuth(linkedUser);

        // 4. TOAST-FEEDBACK & MODAL SCHLIESSEN:
        showToast('🎉 Konto erfolgreich dauerhaft gesichert! Seine Pflanzen sind geschützt.');
        setIsAuthModalOpen(false);
        setAuthEmail('');
        setAuthPassword('');
        setShowSwitchAccount(false);
      } else {
        // 2. STANDARD-LOGIN (Bereits bestehendes Konto oder kein Gast):
        const res = await signInWithPopup(auth, googleProvider);
        await updateUserProfileAfterAuth(res.user);

        showToast('👋 Willkommen zurück!');
        setIsAuthModalOpen(false);
        setAuthEmail('');
        setAuthPassword('');
        setShowSwitchAccount(false);
      }
    } catch (error: any) {
      const isExpected = [
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/popup-blocked',
        'auth/credential-already-in-use',
        'auth/email-already-in-use',
      ].includes(error?.code);

      if (isExpected) {
        console.warn('Google Auth notice:', error.code || error.message);
      } else {
        console.error('Google Auth / Linking Error:', error);
      }

      // 2. ABFANGEN VON 'auth/credential-already-in-use':
      if (
        error.code === 'auth/credential-already-in-use' ||
        error.code === 'auth/email-already-in-use'
      ) {
        try {
          // Automatischer Fallback auf normalen Login mit dem bestehenden Google-Konto
          const res = await signInWithPopup(auth, googleProvider);
          await updateUserProfileAfterAuth(res.user);
          showToast('👋 Willkommen zurück!');
          setIsAuthModalOpen(false);
          setAuthEmail('');
          setAuthPassword('');
          setShowSwitchAccount(false);
          return;
        } catch (fallbackErr: any) {
          console.error('Google fallback login error:', fallbackErr);
          setAuthError('Dieses Google-Konto existiert bereits. Bitte melde dich an.');
          return;
        }
      } else if (error.code === 'auth/popup-closed-by-user') {
        setAuthError('Anmeldung im Popup-Fenster abgebrochen.');
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Doppelter Aufruf abgebrochen
      } else if (error.code === 'auth/popup-blocked') {
        setAuthError('Popup vom Browser blockiert. Bitte Popups in den Einstellungen erlauben.');
      } else {
        setAuthError(error.message || 'Fehler bei der Google-Authentifizierung.');
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // Sub-Step 7.3.2: E-Mail / Passwort Submit Handler mit Account Linking & Fallback
  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const cleanEmail = authEmail.trim();
    const cleanPassword = authPassword;

    if (!cleanEmail) {
      setAuthError('Bitte gib eine E-Mail-Adresse ein.');
      return;
    }
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setAuthError('Ungültige E-Mail Adresse.');
      return;
    }
    if (!cleanPassword) {
      setAuthError('Bitte gib ein Passwort ein.');
      return;
    }
    if (cleanPassword.length < 6) {
      setAuthError('Passwort zu kurz (mindestens 6 Zeichen).');
      return;
    }

    setIsAuthSubmitting(true);
    triggerHaptic('subtle');

    try {
      if (authMode === 'login') {
        // 2. STANDARD-LOGIN FÜR BESTEHENDE KONTEN (Tab "Anmelden"):
        const res = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
        await updateUserProfileAfterAuth(res.user);

        showToast('👋 Willkommen zurück!');
        setIsAuthModalOpen(false);
        setAuthEmail('');
        setAuthPassword('');
        setShowSwitchAccount(false);
      } else {
        // 1. ACCOUNT-LINKING FÜR ANONYME GÄSTE (Tab "Konto erstellen"):
        if (currentUser && currentUser.isAnonymous) {
          // 1. Erstelle das Credential
          const credential = EmailAuthProvider.credential(cleanEmail, cleanPassword);
          try {
            // 2. Verknüpfe das Anonyme Konto (UID bleibt identisch!)
            let linkedUser: User;
            if (typeof (currentUser as any).linkWithCredential === 'function') {
              const res = await (currentUser as any).linkWithCredential(credential);
              linkedUser = res.user;
            } else {
              const res = await linkWithCredential(currentUser, credential);
              linkedUser = res.user;
            }

            // 3. FIRESTORE-DOKUMENT UPDATE (users/{uid}):
            await updateUserProfileAfterAuth(linkedUser);

            // 4. TOAST-FEEDBACK & MODAL SCHLIESSEN:
            showToast('🎉 Konto erfolgreich dauerhaft gesichert! Seine Pflanzen sind geschützt.');
            setIsAuthModalOpen(false);
            setAuthEmail('');
            setAuthPassword('');
            setShowSwitchAccount(false);
          } catch (linkError: any) {
            // 2. ABFANGEN VON 'auth/credential-already-in-use':
            if (
              linkError.code === 'auth/credential-already-in-use' ||
              linkError.code === 'auth/email-already-in-use'
            ) {
              // Automatisch versuchen, mit bestehendem Account einzuloggen:
              try {
                const signInRes = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
                await updateUserProfileAfterAuth(signInRes.user);

                showToast('👋 Willkommen zurück!');
                setIsAuthModalOpen(false);
                setAuthEmail('');
                setAuthPassword('');
                setShowSwitchAccount(false);
                return;
              } catch (signInErr: any) {
                setAuthError('Diese E-Mail ist bereits registriert. Bitte melde dich im Tab "Anmelden" mit deinem Passwort an.');
                setAuthMode('login');
                return;
              }
            } else if (
              linkError.code === 'auth/invalid-credential' ||
              linkError.code === 'auth/wrong-password'
            ) {
              setAuthError('E-Mail oder Passwort ist nicht korrekt.');
              return;
            } else if (linkError.code === 'auth/weak-password') {
              setAuthError('Passwort zu schwach (mindestens 6 Zeichen).');
            } else if (linkError.code === 'auth/invalid-email') {
              setAuthError('Ungültige E-Mail Adresse.');
            } else {
              setAuthError(linkError.message || 'Fehler beim Verknüpfen des Kontos.');
            }
          }
        } else {
          // Falls kein anonymer User aktiv ist, reguläres Konto erstellen
          const res = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
          await updateUserProfileAfterAuth(res.user);

          showToast('🎉 Konto erfolgreich dauerhaft gesichert! Seine Pflanzen sind geschützt.');
          setIsAuthModalOpen(false);
          setAuthEmail('');
          setAuthPassword('');
          setShowSwitchAccount(false);
        }
      }
    } catch (error: any) {
      const isExpectedAuthError = [
        'auth/email-already-in-use',
        'auth/credential-already-in-use',
        'auth/invalid-email',
        'auth/user-not-found',
        'auth/wrong-password',
        'auth/invalid-credential',
        'auth/weak-password',
      ].includes(error?.code);

      if (isExpectedAuthError) {
        console.warn('Authentication notice:', error.code || error.message);
      } else {
        console.error('Email Auth Error:', error);
      }

      if (
        error.code === 'auth/email-already-in-use' ||
        error.code === 'auth/credential-already-in-use'
      ) {
        setAuthError('Diese E-Mail wird bereits verwendet. Bitte melde dich an.');
        setAuthMode('login');
      } else if (error.code === 'auth/invalid-email') {
        setAuthError('Ungültige E-Mail Adresse.');
      } else if (
        error.code === 'auth/user-not-found' ||
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/invalid-credential'
      ) {
        setAuthError('E-Mail oder Passwort ist nicht korrekt.');
      } else if (error.code === 'auth/weak-password') {
        setAuthError('Passwort zu schwach (mindestens 6 Zeichen).');
      } else {
        setAuthError(error.message || 'Fehler bei der Authentifizierung.');
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // Sub-Step 7.3.3: Abmelden (Sign Out) mit Session-Reset & Feedback
  const handleSignOut = async () => {
    setIsAuthSubmitting(true);
    triggerHaptic('subtle');
    try {
      // Unsubscribe den aktiven Pflanzen-Listener vor dem Token-Widerruf
      if (plantsUnsubscribeRef.current) {
        plantsUnsubscribeRef.current();
        plantsUnsubscribeRef.current = null;
      }
      // Entkopple ausgewählte Pflanze und Status sofort
      setSelectedPlant(null);
      setSelectedPlantForScanId('');
      setConfirmDeleteId(null);
      setPlants([]);
      setCurrentUser(null);
      setIsLoading(true);

      await signOut(auth);
      // Toast-Feedback: ("👋 Erfolgreich abgemeldet. Neue Gast-Sitzung gestartet.")
      showToast('👋 Erfolgreich abgemeldet. Neue Gast-Sitzung gestartet.');
      // Schließe das Profil-Modal automatisch
      setIsAuthModalOpen(false);
      setShowSwitchAccount(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthError(null);
    } catch (error) {
      console.error('Sign out error:', error);
      showToast('Fehler beim Abmelden');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleOpenModal = () => {
    triggerHaptic('subtle');
    setFormData({
      name: '',
      species: 'Dionaea muscipula (Venusfliegenfalle)',
      zipCode: '',
    });
    setZipValidation({ status: 'idle' });
    setFormError(null);
    setIncompatibilityWarning(null);
    setIsSavedWithWarning(false);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    triggerHaptic('subtle');
    setIsModalOpen(false);
    setIsSpeciesDropdownOpen(false);
    setZipValidation({ status: 'idle' });
    setFormError(null);
    setIncompatibilityWarning(null);
    setIsSavedWithWarning(false);
  };

  // Gieß-Tracker: Schnell-Aktion "💧 Gegossen" (Mikro-Haptik: subtle)
  const handleWaterPlant = async (plantId: string) => {
    if (!currentUser || !currentUser.uid) {
      showToast('⚠️ Authentifizierung erforderlich');
      return;
    }
    triggerHaptic('subtle');
    setIsWateringId(plantId);
    try {
      const nowTs = Timestamp.now();
      await updateDoc(doc(db, 'users', currentUser.uid, 'plants', plantId), {
        lastWateredAt: serverTimestamp(),
        wateringHistory: arrayUnion(nowTs),
      });
      showToast('Wasserstand aktualisiert');
    } catch (error) {
      console.error('Error watering plant:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}/plants/${plantId}`);
      showToast('Fehler beim Aktualisieren des Gießstatus');
    } finally {
      setIsWateringId(null);
    }
  };

  // CREATE (Pflanze hinzufügen) (Mikro-Haptik: success)
  const handleSavePlant = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser || !currentUser.uid) {
      setFormError('Sitzung wird initialisiert, bitte kurz warten...');
      return;
    }

    if (!formData.name.trim()) {
      setFormError('Bitte gib einen Namen für die Pflanze ein.');
      return;
    }
    if (zipValidation.status !== 'valid') {
      setFormError('Bitte gib eine gültige deutsche Postleitzahl ein.');
      return;
    }

    let cleanSpecies = formData.species;
    if (formData.species.includes('(')) {
      cleanSpecies = formData.species.split('(')[0].trim();
    }

    const isIncompatible = checkPlantIncompatibility(cleanSpecies, plants);

    setIsSubmitting(true);
    setFormError(null);

    try {
      const nowTs = Timestamp.now();
      await addDoc(collection(db, 'users', currentUser.uid, 'plants'), {
        name: formData.name.trim(),
        species: cleanSpecies,
        zipCode: formData.zipCode.trim(),
        isDormant: false,
        createdAt: serverTimestamp(),
        lastWateredAt: nowTs,
        wateringHistory: [nowTs],
        diagnosisHistory: [],
      });

      fetchWeatherForZip(formData.zipCode.trim());

      if (isIncompatible) {
        triggerHaptic('warning');
        setIncompatibilityWarning(
          '⚠️ Hinweis zur Zusammenstellung: Nepenthes hat abweichende Licht- und Wasserbedürfnisse. Halte sie nicht im selben Anstau-Untersetzer wie Dionaea oder Sarracenia!'
        );
        setIsSavedWithWarning(true);
        showToast('⚠️ Pflanze gespeichert (Hinweis zur Zusammenstellung beachten)');
      } else {
        triggerHaptic('success');
        showToast('🪴 Pflanze erfolgreich hinzugefügt');
        handleCloseModal();
      }
    } catch (error) {
      console.error('Error adding plant: ', error);
      handleFirestoreError(error, OperationType.CREATE, `users/${currentUser.uid}/plants`);
      setFormError('Fehler beim Speichern der Pflanze in Firestore.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // DELETE (Pflanze entfernen - Sub-Step 7.2.2 Multi-Tenancy)
  const handleDeletePlant = async (id: string, name: string) => {
    if (!currentUser || !currentUser.uid) {
      showToast('⚠️ Authentifizierung erforderlich');
      return;
    }
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'plants', id));
      setConfirmDeleteId(null);
      if (selectedPlant?.id === id) {
        setSelectedPlant(null);
      }
      showToast('🗑️ Pflanze entfernt');
    } catch (error) {
      console.error('Error deleting plant: ', error);
      handleFirestoreError(error, OperationType.DELETE, `users/${currentUser.uid}/plants/${id}`);
      showToast('Fehler beim Entfernen der Pflanze');
    }
  };

  // PWA: In-App Installation Trigger via deferredPrompt
  const handleInstallPWA = async () => {
    triggerHaptic('subtle');
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        triggerHaptic('success');
        showToast('App wird installiert...');
      }
    } catch (err) {
      console.warn('PWA Install Error:', err);
    } finally {
      setDeferredPrompt(null);
      setDismissedInstallBanner(true);
    }
  };

  // Seed default demonstration plants
  const handleSeedDefaults = async () => {
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const defaults = [
        {
          name: 'Lilly',
          species: 'Dionaea muscipula',
          zipCode: '50354',
          isDormant: false,
          createdAt: serverTimestamp(),
          lastWateredAt: Timestamp.fromDate(new Date(now - 1 * 24 * 60 * 60 * 1000)), // Vor 1 Tag -> Optimal
          wateringHistory: [
            Timestamp.fromDate(new Date(now - 1 * 24 * 60 * 60 * 1000)),
            Timestamp.fromDate(new Date(now - 4 * 24 * 60 * 60 * 1000)),
            Timestamp.fromDate(new Date(now - 7 * 24 * 60 * 60 * 1000)),
          ],
          diagnosisHistory: [
            {
              diagnosedAt: Timestamp.fromDate(new Date(now - 1 * 24 * 60 * 60 * 1000)),
              score: 92,
              summary: 'Fallen voll funktionsfähig, aktive Klappreaktion und gesunde Blattentwicklung.',
            },
          ],
          scans: [
            {
              timestamp: Timestamp.fromDate(new Date(now - 1 * 24 * 60 * 60 * 1000)),
              vitalityScore: 92,
              diagnosisSummary: 'Fallen voll funktionsfähig, aktive Klappreaktion und gesunde Blattentwicklung.',
              immediateAction: 'Weiterhin für 1–2 cm kalkfreien Anstau und maximale Sonneneinstrahlung sorgen.',
            },
          ],
        },
        {
          name: 'Klebriger Paul',
          species: 'Drosera capensis',
          zipCode: '80331',
          isDormant: false,
          createdAt: serverTimestamp(),
          lastWateredAt: Timestamp.fromDate(new Date(now - 5 * 24 * 60 * 60 * 1000)), // Vor 5 Tagen -> Prüfen
          wateringHistory: [
            Timestamp.fromDate(new Date(now - 5 * 24 * 60 * 60 * 1000)),
            Timestamp.fromDate(new Date(now - 11 * 24 * 60 * 60 * 1000)),
          ],
          diagnosisHistory: [
            {
              diagnosedAt: Timestamp.fromDate(new Date(now - 3 * 24 * 60 * 60 * 1000)),
              score: 78,
              summary: 'Gute Taubildung an den Tentakeln; leichte Trockenheit an älteren Blattbasen.',
            },
          ],
          scans: [
            {
              timestamp: Timestamp.fromDate(new Date(now - 3 * 24 * 60 * 60 * 1000)),
              vitalityScore: 78,
              diagnosisSummary: 'Gute Taubildung an den Tentakeln; leichte Trockenheit an älteren Blattbasen.',
              immediateAction: 'Anstautiefe im Untersetzer auf ca. 2 cm anheben und kalkfreies Regenwasser nachgießen.',
            },
          ],
        },
        {
          name: 'Trompete Max',
          species: 'Sarracenia',
          zipCode: '10115',
          isDormant: false,
          createdAt: serverTimestamp(),
          lastWateredAt: Timestamp.fromDate(new Date(now - 9 * 24 * 60 * 60 * 1000)), // Vor 9 Tagen -> Auffüllen
          wateringHistory: [
            Timestamp.fromDate(new Date(now - 9 * 24 * 60 * 60 * 1000)),
            Timestamp.fromDate(new Date(now - 16 * 24 * 60 * 60 * 1000)),
          ],
          diagnosisHistory: [
            {
              diagnosedAt: Timestamp.fromDate(new Date(now - 5 * 24 * 60 * 60 * 1000)),
              score: 85,
              summary: 'Kräftige Schläuche mit typischer Äderung, ausreichend Verdauungsflüssigkeit vorhanden.',
            },
          ],
          scans: [
            {
              timestamp: Timestamp.fromDate(new Date(now - 5 * 24 * 60 * 60 * 1000)),
              vitalityScore: 85,
              diagnosisSummary: 'Kräftige Schläuche mit typischer Äderung, ausreichend Verdauungsflüssigkeit vorhanden.',
              immediateAction: 'Regenwasser im Untersetzer auffüllen und verblühte Schläuche erst bei vollständiger Eintrocknung abschneiden.',
            },
          ],
        },
      ];

      if (!currentUser || !currentUser.uid) {
        showToast('Sitzung wird initialisiert...');
        return;
      }

      for (const p of defaults) {
        await addDoc(collection(db, 'users', currentUser.uid, 'plants'), p);
      }
      showToast('🪴 Pflanzen geladen');
    } catch (error) {
      console.error('Error seeding plants: ', error);
      handleFirestoreError(error, OperationType.CREATE, `users/${currentUser?.uid}/plants`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (file && file.type.startsWith('image/')) {
      setDiagnosisError(null);
      setDiagnosisResult(null);
      setScannerMimeType('image/jpeg');

      try {
        // 1. & 2. Automatische Client-Side Bildkomprimierung (max. 1080px, 85% JPEG)
        const compressedBase64 = await compressImage(file, 1080, 0.85);
        setScannerImage(compressedBase64);
      } catch (compressionError) {
        // 3. Fallback: Bei Fehlschlag unkomprimiertes Originalbild verwenden
        console.warn('Canvas-Komprimierung fehlgeschlagen, nutze Originaldatei als Fallback:', compressionError);
        const reader = new FileReader();
        reader.onload = (e) => {
          setScannerImage(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageUpload(e.dataTransfer.files[0]);
    }
  };

  const handleResetScanner = () => {
    setScannerImage(null);
    setDiagnosisResult(null);
    setDiagnosisError(null);
    setIsAnalyzing(false);
    setIsScanSaved(false);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getDemoDiagnosis = (): DiagnosisResult => ({
    isDemo: true,
    plantIdentified: 'Dionaea muscipula (Venusfliegenfalle)',
    vitalityScore: 82,
    diagnosisSummary: 'Demo-Modus aktiv: Dionaea muscipula analysiert. Das Exemplar weist eine gute Wuchsform auf; ältere Fallenränder zeigen leichte Mineralienempfindlichkeit.',
    issues: [
      {
        title: 'Mineralienempfindlichkeit',
        severity: 'mittel',
        description: 'Leichte nekrotische Verfärbung an den äußeren Blattzähnen. Hinweis auf Gießwasser mit zu hohem Leitwert (> 50 ppm TDS).'
      },
      {
        title: 'Lichtmangel (Etiolement)',
        severity: 'keine',
        description: 'Falleninneres weist kräftige Anthocyan-Rotfärbung auf. Keine Anzeichen von Lichtmangel.'
      },
      {
        title: 'Pilzbefall / Fäulnis',
        severity: 'keine',
        description: 'Rhizom und Blattbasen sind fest und hellgrün, keine Fäulnis sichtbar.'
      }
    ],
    immediateAction: 'Sofort auf reines Regen-, Osmose- oder destilliertes Wasser umstellen und mindestens 6 Stunden direkte Sonne bieten.'
  });

  /**
   * Gemini Vision Diagnose API Aufruf
   */
  const handleStartDiagnosis = async () => {
    if (!scannerImage) return;

    setIsAnalyzing(true);
    setDiagnosisError(null);
    setDiagnosisResult(null);
    setIsScanSaved(false);

    // 1. BASE64-FORMATIERUNG REPARIEREN:
    const base64Data = scannerImage.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

    try {
      const response = await fetch('/api/diagnose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageBase64: base64Data,
          mimeType: 'image/jpeg',
        }),
      });

      if (!response.ok) {
        throw new Error(`Server-Status: ${response.status}`);
      }

      const text = await response.text();

      // 2. ROBUSTES JSON-STRIPPING & PARSING:
      let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      let result: DiagnosisResult;
      try {
        result = JSON.parse(cleanText);
      } catch (parseErr) {
        const match = cleanText.match(/\{[\s\S]*\}/);
        if (match) {
          result = JSON.parse(match[0]);
        } else {
          throw parseErr;
        }
      }

      if (!result || typeof result.vitalityScore !== 'number') {
        throw new Error('Ungültiges Antwortformat der KI-Vision.');
      }

      setDiagnosisResult(result);
      triggerHaptic('success');
      if (result.isDemo) {
        showToast('Demo-Modus aktiv: Dionaea muscipula analysiert');
      } else {
        showToast('✨ Analyse abgeschlossen');
      }
    } catch (err: any) {
      // 3. ERROR LOGGING & DEMO-FALLBACK
      console.error('Gemini Scan Error:', err);

      // Biete automatisch eine realistische Demo-Analyse für Testzwecke an
      const fallbackResult = getDemoDiagnosis();
      setDiagnosisResult(fallbackResult);
      triggerHaptic('success');
      showToast('Demo-Modus aktiv: Dionaea muscipula analysiert');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Zuordnung der KI-Diagnose zu einer Pflanze in Firestore
  const handleSaveScanToPlant = async () => {
    if (!currentUser || !currentUser.uid) {
      showToast('⚠️ Authentifizierung erforderlich');
      return;
    }
    if (!diagnosisResult || !selectedPlantForScanId) return;
    setIsSavingScanToPlant(true);
    try {
      const scanEntry: PlantScanRecord = {
        timestamp: Timestamp.now(),
        vitalityScore: diagnosisResult.vitalityScore,
        diagnosisSummary: diagnosisResult.diagnosisSummary,
        immediateAction: diagnosisResult.immediateAction || '',
      };

      await updateDoc(doc(db, 'users', currentUser.uid, 'plants', selectedPlantForScanId), {
        scans: arrayUnion(scanEntry),
      });

      setIsScanSaved(true);
      triggerHaptic('success');
      showToast('✨ Diagnose in Akte gespeichert');
    } catch (error) {
      console.error('Error saving scan to plant:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}/plants/${selectedPlantForScanId}`);
      showToast('Fehler beim Speichern der Diagnose');
    } finally {
      setIsSavingScanToPlant(false);
    }
  };

  // Helper for Vitality Score Badge
  const getVitalityBadgeClass = (score: number) => {
    if (score >= 80) return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    if (score >= 50) return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
    return 'bg-red-500/20 text-red-400 border border-red-500/40';
  };

  // Helper for Issue Severity Badge
  const getSeverityBadge = (severity: string) => {
    const s = severity.toLowerCase();
    if (s.includes('hoch')) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-950/70 text-red-300 border border-red-800/60">
          <AlertCircle className="w-3 h-3 text-red-400" />
          Kritisch
        </span>
      );
    }
    if (s.includes('mittel')) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800/60">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          Mittel
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-300 border border-emerald-800/60">
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        Kein Befall
      </span>
    );
  };

  // Render-Schutz während des Auth-Ladens (Sub-Step 7.1.1):
  // Elegantes M3-Loading-Screen
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-primary)] flex flex-col items-center justify-center p-6 selection:bg-[var(--md-sys-color-primary)] selection:text-white font-sans">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-20 h-20 rounded-full bg-[var(--md-sys-color-primary-container)] animate-ping" />
            <div className="w-16 h-16 rounded-[28px] bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-3xl relative z-10 animate-pulse">
              🪴
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-bold tracking-tight text-[var(--md-sys-color-on-surface)] flex items-center justify-center gap-2">
              <span>Carnivora Care</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] animate-pulse" />
            </h1>
            <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] font-mono">
              Initialisiere Authentifizierung...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] selection:bg-[var(--md-sys-color-primary)] selection:text-white pb-28 font-sans">
      {/* Centered Mobile-First Frame in M3 Light Surface */}
      <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[var(--md-sys-color-surface)] border-x border-[var(--md-sys-color-outline-variant)] relative">
        
        {/* ========================================================
            HEADER (Fixed at top - Ebene 2: M3 Surface-Container-High & Ambient Shadow)
           ======================================================== */}
        <header className="sticky top-0 z-30 bg-[var(--md-sys-color-surface-container-high)]/95 backdrop-blur-md border-b border-[var(--md-sys-color-outline-variant)] shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)] px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-lg select-none shrink-0 shadow-none">
              🪴
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-bold text-base tracking-tight text-[var(--md-sys-color-on-surface)] shrink-0">
                  Carnivora Care
                </h1>

                {/* M3 Header User-Badge für den Login-Status */}
                {currentUser && (
                  currentUser.isAnonymous ? (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setIsAuthModalOpen(true);
                      }}
                      title="Gast-Sitzung (Klicken für Details)"
                      aria-label="Gast-Sitzung Status"
                      className="bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)] text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 cursor-pointer hover:border-[var(--md-sys-color-primary)] transition-all select-none"
                    >
                      <UserIcon className="w-3 h-3 text-[var(--md-sys-color-on-surface-variant)] shrink-0" />
                      <span className="leading-none">Gast-Sitzung</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setShowSwitchAccount(false);
                        setIsAuthModalOpen(true);
                      }}
                      title={`Eingeloggt als ${currentUser.email || currentUser.displayName || 'Stamm-User'}`}
                      aria-label="Benutzerkonto Status"
                      className="bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 text-[var(--md-sys-color-on-primary-container)] text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 cursor-pointer hover:border-[var(--md-sys-color-primary)] transition-all select-none"
                    >
                      <span className="bg-[var(--md-sys-color-primary)] w-1.5 h-1.5 rounded-full shrink-0" />
                      <span className="max-w-[100px] truncate leading-none font-medium">
                        {currentUser.displayName || (currentUser.email ? (currentUser.email.length > 10 ? `${currentUser.email.slice(0, 8)}...` : currentUser.email) : 'Stamm-User')}
                      </span>
                    </button>
                  )
                )}
              </div>
              <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] leading-none mt-1">
                Karnivoren-Monitoring &amp; KI-Diagnose
              </p>
            </div>
          </div>

          {/* Primary CTA (Header): Deep Forest Button */}
          <button
            type="button"
            onClick={handleOpenModal}
            aria-label="Neue Pflanze hinzufügen"
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--md-sys-color-primary)] hover:bg-[#03593e] text-[var(--md-sys-color-on-primary)] font-semibold transition-all cursor-pointer active:scale-95 focus:outline-none shrink-0 ml-2"
          >
            <Plus className="w-4 h-4 stroke-[2.25]" />
          </button>
        </header>

        {/* Elegant Floating Toast Notification Pill (Ebene 3) */}
        {toastMessage && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)] flex items-center gap-2 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] animate-pulse" />
              <span>{toastMessage}</span>
            </div>
          </div>
        )}

        {/* Main Content Area mit sicherem Scroll-Abstand nach unten */}
        <main className="flex-1 p-4 pb-28">
          {/* ========================================================
              TAB 1: DASHBOARD ("Meine Pflanzen")
             ======================================================== */}
          {activeTab === 'plants' && (
            <div className="space-y-4">
              {/* In-App Installation Banner: Wenn die App installierbar ist und nicht bereits im Standalone-Modus läuft */}
              {deferredPrompt && !isStandalone && !dismissedInstallBanner && (
                <div className="bg-zinc-950 border border-emerald-800/40 rounded-2xl p-3.5 shadow-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg select-none shrink-0" role="img" aria-label="Smartphone">
                      📲
                    </span>
                    <p className="text-xs text-zinc-200 font-medium leading-tight">
                      Carnivora Care als App auf dem Homescreen installieren
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleInstallPWA}
                      className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs rounded-xl transition-all cursor-pointer shadow-sm active:scale-95"
                    >
                      Installieren
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setDismissedInstallBanner(true);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg cursor-pointer transition-colors"
                      title="Ausblenden"
                      aria-label="Installations-Banner schließen"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Header Meta Bar */}
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    <span>Meine Pflanzen</span>
                    {!isLoading && (
                      <span className="text-[11px] bg-zinc-900 text-zinc-300 border border-zinc-800 px-2 py-0.5 rounded-full font-mono">
                        {plants.length}
                      </span>
                    )}
                  </h2>
                  <p className="text-[11px] text-zinc-500">
                    Live-Klimadaten & automatische Dormanz-Auswertung
                  </p>
                </div>

                {plants.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      weatherCache.clear();
                      plants.forEach((p) => fetchWeatherForZip(p.zipCode, true));
                      showToast('Wetterdaten werden aktualisiert...');
                    }}
                    title="Wetterdaten neu abrufen"
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-400 bg-zinc-950 border border-zinc-900 hover:border-zinc-800 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Strukturelle Skeleton-Platzhalter beim initialen Firestore Laden */}
              {isLoading ? (
                <div className="space-y-3" role="status" aria-label="Lade Pflanzen...">
                  <PlantCardSkeleton />
                  <PlantCardSkeleton />
                  <PlantCardSkeleton />
                  <span className="sr-only">Lade Pflanzen...</span>
                </div>
              ) : plants.length > 0 ? (
                /* Pflanzenkarten im M3 Expressive Light Mode (Ebene 1: Radius 28px, Tonal Elevation & 200ms ease-out Lift) */
                <div className="space-y-3">
                  {plants.map((plant) => {
                    const cleanZip = plant.zipCode.trim();
                    const weather = weatherMap[cleanZip];
                    const temp = weather?.temperature ?? 12;
                    const dormancy = getDormancyStatus(plant.species, temp);
                    const watering = getWateringStatus(plant.lastWateredAt);
                    const isConfirmingDelete = confirmDeleteId === plant.id;

                    return (
                      <article
                        key={plant.id}
                        onClick={() => {
                          triggerHaptic('subtle');
                          setSelectedPlant(plant);
                        }}
                        className="group relative m3-plant-card rounded-[28px] p-4 transition-all duration-200 ease-out border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-high)] hover:border-[var(--md-sys-color-primary)]/40 hover:shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)] flex flex-col gap-3 cursor-pointer active:scale-[0.99]"
                      >
                        {/* Upper Section */}
                        <div className="flex items-start justify-between gap-3">
                          {/* Eingebettete Sub-Kachel: Reinweiß (surface-container-lowest #FFFFFF) */}
                          <div className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0 group-hover:scale-105 transition-all select-none shadow-none">
                            <SpeciesIcon species={plant.species} className="w-6 h-6 stroke-[1.8]" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="font-bold text-base text-[var(--md-sys-color-on-surface)] truncate tracking-tight group-hover:text-[var(--md-sys-color-primary)] transition-colors">
                                {plant.name}
                              </h3>

                              {/* Lösch-Bestätigung (Ebene 3: Dialog-Popup mit StopPropagation) */}
                              <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                                {isConfirmingDelete ? (
                                  <div className="flex items-center gap-1 animate-in fade-in duration-150 p-1 rounded-xl bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)]">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        triggerHaptic('subtle');
                                        setConfirmDeleteId(null);
                                        handleDeletePlant(plant.id, plant.name);
                                      }}
                                      className="px-2 py-1 text-[10px] font-semibold text-red-700 bg-red-100 border border-red-300 rounded-lg hover:bg-red-200 transition-colors cursor-pointer"
                                      title="Endgültig löschen"
                                    >
                                      Löschen?
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        triggerHaptic('subtle');
                                        setConfirmDeleteId(null);
                                      }}
                                      className="p-1 text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] rounded-lg cursor-pointer"
                                      title="Abbrechen"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      triggerHaptic('warning');
                                      setConfirmDeleteId(plant.id);
                                    }}
                                    aria-label={`Pflanze ${plant.name} entfernen`}
                                    className="text-[var(--md-sys-color-outline)] hover:text-red-600 transition-colors p-1.5 rounded-xl cursor-pointer active:scale-90"
                                    title="Pflanze entfernen"
                                  >
                                    <Trash2 className="w-4 h-4 stroke-[1.8]" />
                                  </button>
                                )}
                              </div>
                            </div>
                            
                            <p className="text-xs italic text-[var(--md-sys-color-on-surface-variant)] tracking-wide truncate mt-0.5">
                              {plant.species}
                            </p>

                            {/* Status-Badges in aufgeräumter Zeile */}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <span
                                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-medium ${dormancy.badgeClass}`}
                              >
                                <span className={`shrink-0 ${dormancy.dotClass}`} />
                                <span>{dormancy.badgeLabel}</span>
                              </span>

                              {/* Skeleton-Balken bei Ladevorgang der Wetterdaten */}
                              {!weather || weather.loading ? (
                                <span
                                  className="w-16 h-4 bg-[var(--md-sys-color-surface-container-highest)] animate-pulse rounded inline-block"
                                  title="Lade Temperatur..."
                                />
                              ) : typeof weather.temperature === 'number' ? (
                                /* Eingebettete Sub-Kachel: Reinweiß (surface-container-lowest #FFFFFF) */
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-[var(--md-sys-color-on-surface)] bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] px-2.5 py-0.5 rounded-full font-mono"
                                  title={`${weather.cityName ? weather.cityName + ', ' : ''}PLZ ${cleanZip}`}
                                >
                                  <MapPin className="w-3 h-3 text-[var(--md-sys-color-primary)]" />
                                  <span>
                                    {weather.cityName ? `${weather.cityName} • ` : ''}
                                    {weather.temperature.toFixed(1)}°C
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--md-sys-color-on-surface-variant)] bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] px-2.5 py-0.5 rounded-full font-mono">
                                  <MapPin className="w-3 h-3 text-[var(--md-sys-color-outline)]" />
                                  <span>{cleanZip}</span>
                                </span>
                              )}

                              {/* Substrat-Spül-Erinnerung */}
                              {substrateRinseReminder && (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 px-2.5 py-0.5 rounded-full font-medium"
                                  title="Substrat-Spülung zur Vermeidung von Salz- & Mineralablagerungen"
                                >
                                  <span>🚿 Substratspülung in {getSubstrateRinseDays(plant.createdAt, plant.id)} {getSubstrateRinseDays(plant.createdAt, plant.id) === 1 ? 'Tag' : 'Tagen'}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Bottom Bar: Status-Vorschau & Klick-Aufforderung mit Gieß-Button */}
                        <div className="pt-2.5 border-t border-[var(--md-sys-color-outline-variant)] flex items-center justify-between text-[11px] text-[var(--md-sys-color-on-surface-variant)] transition-colors">
                          <span className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${watering.dotClass}`} />
                            <span className="truncate">
                              {watering.days <= 3 ? 'Anstau optimal' : watering.days <= 7 ? 'Wasserstand prüfen' : 'Anstau auffüllen'}
                            </span>
                          </span>

                          <div className="flex items-center gap-2">
                            {/* Eingebettete Sub-Kachel: Gegossen-Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWaterPlant(plant.id);
                              }}
                              disabled={isWateringId === plant.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-primary)] border border-[var(--md-sys-color-outline-variant)] text-[10px] font-medium transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                              title="Schnell als heute gegossen markieren"
                            >
                              {isWateringId === plant.id ? (
                                <Loader2 className="w-3 h-3 animate-spin text-[var(--md-sys-color-primary)]" />
                              ) : (
                                <Droplets className="w-3 h-3 text-[var(--md-sys-color-primary)]" />
                              )}
                              <span>{isWateringId === plant.id ? 'Speichert...' : 'Gegossen'}</span>
                            </button>

                            <span className="flex items-center gap-0.5 text-[var(--md-sys-color-primary)] font-semibold group-hover:translate-x-0.5 transition-transform">
                              <span>Akte</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                /* Edler Empty State im M3 Light Design */
                <div className="text-center py-12 px-6 bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-[28px]">
                  <div className="w-12 h-12 mx-auto mb-3.5 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)]">
                    <Leaf className="w-6 h-6 stroke-[1.75]" />
                  </div>
                  <h3 className="font-bold text-[var(--md-sys-color-on-surface)] text-sm mb-1">
                    Dein Moorbeet ist noch leer.
                  </h3>
                  <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] max-w-xs mx-auto mb-5 leading-relaxed">
                    Füge deine erste Pflanze hinzu!
                  </p>
                  
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
                    {/* "Pflanze anlegen" CTA (Empty State) */}
                    <button
                      type="button"
                      onClick={handleOpenModal}
                      className="inline-flex items-center justify-center gap-1.5 bg-[var(--md-sys-color-primary)] hover:bg-[#03593e] text-[var(--md-sys-color-on-primary)] font-semibold rounded-xl transition-all text-xs px-4 py-2.5 cursor-pointer active:scale-95"
                    >
                      <Plus className="w-4 h-4 stroke-[2.25]" />
                      <span>Pflanze anlegen</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSeedDefaults}
                      disabled={isSubmitting}
                      className="inline-flex items-center justify-center gap-1 text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer"
                    >
                      <span>Demo-Daten laden</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Minimalist Botanical Tip Box in M3 Container */}
              <div className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-[28px] p-4 text-xs text-[var(--md-sys-color-on-surface-variant)] flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <span className="font-bold text-[var(--md-sys-color-on-surface)] block text-xs">
                    Automatische Dormanz-Regel:
                  </span>
                  <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
                    Ab dauerhaften Temperaturen unter 10°C leiten Venusfliegenfallen und Schlauchpflanzen ihre lebensnotwendige Winterruhe ein. Bei frostigen Phasen sollte der Moorkübel vor Durchfrieren geschützt werden.
                  </p>
                </div>
              </div>

              {/* Floating Action Button (Ebene 3: surface-container-highest & Soft Ambient Shadow) */}
              {plants.length > 0 && (
                <div className="fixed bottom-20 right-4 z-20 animate-in fade-in zoom-in-95 duration-200">
                  <button
                    type="button"
                    onClick={handleOpenModal}
                    aria-label="Neue Pflanze hinzufügen"
                    title="Neue Pflanze hinzufügen"
                    className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[var(--md-sys-color-surface-container-highest)] hover:bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)] font-semibold text-xs border border-[var(--md-sys-color-outline-variant)] shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)] hover:shadow-[0_6px_24px_-2px_rgba(2,67,46,0.10)] transition-all duration-200 ease-out cursor-pointer active:scale-95 group"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5] group-hover:rotate-90 transition-transform duration-200" />
                    <span>Pflanze hinzufügen</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ========================================================
              TAB 2: KI-SCANNER (Gemini Vision Analyse)
             ======================================================== */}
          {activeTab === 'scanner' && (
            <div className="space-y-4">
              {/* Header Info */}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">
                    KI-Diagnose-Scanner
                  </h2>
                  <span className="text-[10px] font-mono uppercase bg-zinc-900 text-emerald-400 border border-zinc-800 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                    Gemini Vision
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Erkenne Mineralienverbrennungen, Lichtmangel und Pilzbefall per Bildanalyse.
                </p>
              </div>

              {/* Hidden file and camera inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleImageUpload(e.target.files[0]);
                  }
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleImageUpload(e.target.files[0]);
                  }
                }}
              />

              {/* Image Preview OR Dropzone */}
              {scannerImage ? (
                <div className="relative rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 p-2 shadow-none">
                  <img
                    src={scannerImage}
                    alt="Hochgeladene Pflanze zur Diagnose"
                    className="max-h-64 object-cover rounded-xl border border-zinc-850 w-full"
                  />
                  <button
                    type="button"
                    onClick={handleResetScanner}
                    disabled={isAnalyzing}
                    className="absolute top-4 right-4 bg-black/80 hover:bg-red-950/80 text-zinc-300 hover:text-red-300 p-2 rounded-xl border border-zinc-700/80 transition-all cursor-pointer backdrop-blur-md active:scale-95 disabled:opacity-40"
                    title="Foto entfernen"
                  >
                    <X className="w-4 h-4 stroke-[2.5]" />
                  </button>
                </div>
              ) : (
                /* Elegante, gestrichelte Drag-&-Drop-Zone */
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-950 p-8 text-center cursor-pointer hover:border-emerald-500 transition-colors select-none ${
                    isDragging ? 'border-emerald-400 bg-emerald-950/20' : ''
                  }`}
                >
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="w-13 h-13 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 shadow-none">
                      <Camera className="w-6 h-6 stroke-[1.8]" />
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-white">
                        Pflanzenfoto hier ablegen oder aufnehmen
                      </p>
                      <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
                        Fokussiere auf verfärbte Fallen, Blattspitzen oder das Rhizom
                      </p>
                    </div>

                    {/* Action Buttons for Mobile / Desktop */}
                    <div
                      className="flex flex-wrap items-center justify-center gap-2 pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-zinc-900 hover:bg-zinc-850 px-3.5 py-2 rounded-xl border border-zinc-800 hover:border-emerald-800/60 transition-all cursor-pointer shadow-none"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Foto aufnehmen
                      </button>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-850 px-3.5 py-2 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer"
                      >
                        <UploadCloud className="w-3.5 h-3.5 text-zinc-400" />
                        Datei auswählen
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Alert */}
              {diagnosisError && (
                <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-900/60 text-red-200 text-xs flex items-center justify-between gap-2.5 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{diagnosisError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDiagnosisError(null)}
                    className="text-red-400 hover:text-red-200 p-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Lade-Zustand (Loading State) */}
              {isAnalyzing && (
                <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 space-y-4 shadow-none text-center">
                  <div className="flex items-center justify-center">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full border-2 border-zinc-800 border-t-emerald-400 animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-emerald-300">
                      🪴 Gemini Vision analysiert Gewebe & Ausfärbung...
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Prüfe auf Mineralienverbrennung, Etiolement und Botrytis-Fäulnis
                    </p>
                  </div>

                  {/* Modern Skeleton Pulse Bar */}
                  <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full w-2/3 rounded-full animate-pulse" />
                  </div>
                </div>
              )}

              {/* CTA-Button: "Diagnose starten" (KI-Scanner): Strikte Durchsetzung des harmonisierten OLED-Designs */}
              {!isAnalyzing && !diagnosisResult && (
                <button
                  type="button"
                  disabled={!scannerImage}
                  onClick={handleStartDiagnosis}
                  className="w-full py-3.5 px-6 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 border border-zinc-800 hover:border-emerald-800/60 font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-none active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span>Diagnose starten</span>
                </button>
              )}

              {/* ERGEBNIS-DARSTELLUNG (Obsidian-Kacheln) */}
              {diagnosisResult && (
                <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 shadow-none animate-in fade-in duration-300">
                  {/* Header-Kachel: Identifizierte Pflanze & Vitalitäts-Score */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-900">
                    <div>
                      <span className="text-[11px] text-zinc-500 uppercase tracking-wider block font-mono">
                        Erkannte Spezies
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 shrink-0 shadow-none">
                          <SpeciesIcon species={diagnosisResult.plantIdentified} className="w-4 h-4 stroke-[1.8]" />
                        </div>
                        <h3 className="text-white font-bold text-lg tracking-tight">
                          {diagnosisResult.plantIdentified || 'Karnivore Pflanze'}
                        </h3>
                        {diagnosisResult.isDemo && (
                          <span className="text-[10px] font-mono uppercase bg-amber-950/60 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded-full font-medium">
                            Demo-Modus
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="text-[11px] text-zinc-500 uppercase tracking-wider block font-mono">
                        Vitalität
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold mt-1 shadow-none ${getVitalityBadgeClass(
                          diagnosisResult.vitalityScore
                        )}`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {diagnosisResult.vitalityScore}%
                      </span>
                    </div>
                  </div>

                  {/* Diagnose-Summary */}
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                      Befund-Zusammenfassung
                    </h4>
                    <p className="text-zinc-200 text-sm leading-relaxed">
                      {diagnosisResult.diagnosisSummary}
                    </p>
                  </div>

                  {/* Issues-Liste */}
                  {diagnosisResult.issues && diagnosisResult.issues.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        Spezifische Symptome & Krankheitsbilder
                      </h4>
                      <div className="space-y-2">
                        {diagnosisResult.issues.map((issue, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-850 flex flex-col gap-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-white">
                                {issue.title}
                              </span>
                              {getSeverityBadge(issue.severity)}
                            </div>
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                              {issue.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sofort-Handlungsempfehlung: Muted-Smaragd Box */}
                  {diagnosisResult.immediateAction && (
                    <div className="bg-emerald-950/40 border border-emerald-800/50 p-4 rounded-xl text-emerald-200 text-sm space-y-1 shadow-none">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-xs uppercase tracking-wider">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Sofortmaßnahme</span>
                      </div>
                      <p className="text-xs text-emerald-200 leading-relaxed pt-0.5">
                        {diagnosisResult.immediateAction}
                      </p>
                    </div>
                  )}

                  {/* Zuordnungs-Bereich: Diagnose einer Pflanze zuweisen */}
                  <div className="bg-zinc-900/80 border border-zinc-850 rounded-xl p-4 space-y-3 shadow-none">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400 shrink-0">
                        <BookOpen className="w-3.5 h-3.5" />
                      </div>
                      <h4 className="text-xs font-bold text-white tracking-wide uppercase">
                        Diagnose einer Pflanze zuweisen
                      </h4>
                    </div>

                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Wähle eine Pflanze aus deiner Sammlung, um das Ergebnis dauerhaft in ihrer Pflanzen-Akte zu sichern:
                    </p>

                    {plants.length === 0 ? (
                      <div className="p-3 bg-zinc-950 border border-zinc-850 rounded-xl text-xs text-zinc-400">
                        Keine Pflanzen in der Sammlung vorhanden. Bitte lege zuerst im Dashboard eine Pflanze an.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="relative">
                          <select
                            value={selectedPlantForScanId}
                            onChange={(e) => {
                              setSelectedPlantForScanId(e.target.value);
                              setIsScanSaved(false);
                            }}
                            disabled={isSavingScanToPlant}
                            className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-xl px-3.5 py-2.5 appearance-none focus:outline-none focus:border-emerald-500/80 transition-colors cursor-pointer pr-10"
                          >
                            <option value="" disabled>
                              Pflanze auswählen...
                            </option>
                            {plants.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.species})
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="w-4 h-4 text-zinc-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>

                        <button
                          type="button"
                          onClick={handleSaveScanToPlant}
                          disabled={!selectedPlantForScanId || isSavingScanToPlant || isScanSaved}
                          className={`w-full py-3 px-4 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-none ${
                            isScanSaved
                              ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/60 cursor-default'
                              : 'bg-zinc-900 hover:bg-zinc-850 text-emerald-400 border border-zinc-800 hover:border-emerald-800/60 cursor-pointer active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed'
                          }`}
                        >
                          {isSavingScanToPlant ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Wird in Akte gespeichert...</span>
                            </>
                          ) : isScanSaved ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>✓ In Pflanzen-Akte gespeichert</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Diagnose in Pflanzen-Akte speichern</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* CTA: "Neue Analyse durchführen": Strikte Durchsetzung des harmonisierten OLED-Designs */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleResetScanner}
                      className="w-full py-3 px-4 text-xs bg-zinc-900 hover:bg-zinc-800 text-emerald-400 border border-zinc-800 hover:border-emerald-800/60 font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] shadow-none"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Neue Analyse durchführen</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Explanation guide when no image is loaded yet */}
              {!scannerImage && (
                <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 space-y-3">
                  <h4 className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    Krankheitsmuster-Erkennung
                  </h4>

                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-850">
                      <SunMedium className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-zinc-200">Lichtmangel (Etiolement)</span>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Erkennt verblasste, überlange Fangblätter ohne rötliche Pigmentierung.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-850">
                      <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-zinc-200">Mineralienverbrennung</span>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Prüft braune, nekrotische Blattränder durch zu kalkhaltiges Gießwasser.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-850">
                      <ThermometerSnowflake className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-zinc-200">Rhizomfäule & Pilzbefall</span>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Identifiziert matschiges Gewebe oder Schimmel bei staunasser Kälte.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================
              TAB 3: EINSTELLUNGEN & TOOLS
             ======================================================== */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* SUBVIEW 1: HAUPT-ÜBERSICHT */}
              {settingsSubView === 'main' && (
                <div className="space-y-5">
                  {/* Header Title */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-white tracking-tight">
                        Einstellungen &amp; Tools
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        App-Optionen und botanische Fach-Rechner
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full">
                      v1.2 OLED
                    </span>
                  </div>

                  {/* BEREICH A: App-Optionen */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                      <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        App-Optionen
                      </h3>
                    </div>

                    <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 shadow-none space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <label
                            className="text-xs font-semibold text-zinc-100 cursor-pointer block"
                            onClick={handleToggleSubstrateReminder}
                          >
                            Substrat-Spül-Erinnerungen aktivieren
                          </label>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            Erinnert an periodisches Durchspülen mit Reinwasser zur Vermeidung von Salz- &amp; Mineralienablagerungen.
                          </p>
                        </div>

                        {/* Eleganter OLED-Toggle-Switch (bg-zinc-900 border border-zinc-800, bei aktiv emerald-500) */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={substrateRinseReminder}
                          onClick={handleToggleSubstrateReminder}
                          aria-label="Substrat-Spül-Erinnerungen aktivieren"
                          className={`w-12 h-6.5 rounded-full p-0.5 transition-colors duration-200 ease-in-out cursor-pointer flex items-center shrink-0 border ${
                            substrateRinseReminder
                              ? 'bg-emerald-500 border-emerald-400'
                              : 'bg-zinc-900 border-zinc-800'
                          }`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full shadow-none transform transition-transform duration-200 ease-in-out ${
                              substrateRinseReminder
                                ? 'translate-x-5.5 bg-black'
                                : 'translate-x-0.5 bg-zinc-400'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="pt-2.5 border-t border-zinc-900 flex items-center justify-between text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${substrateRinseReminder ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          <span>Status: {substrateRinseReminder ? 'Erinnerungs-Intervall (4 Wochen) aktiv' : 'Deaktiviert'}</span>
                        </span>
                        <span className="text-[10px] font-mono text-zinc-600">Präferenz gesichert</span>
                      </div>
                    </div>
                  </div>

                  {/* BEREICH B: Tools & Wissen (Unter-Navigations-Kacheln) */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                      <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        Tools &amp; Wissen
                      </h3>
                    </div>

                    <div className="space-y-2.5">
                      {/* Kachel 1: 💧 Wasser- & TDS-Rechner */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          triggerHaptic('subtle');
                          setSettingsSubView('water_calc');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            triggerHaptic('subtle');
                            setSettingsSubView('water_calc');
                          }
                        }}
                        className="group bg-zinc-950 border border-zinc-900 hover:border-zinc-800 rounded-2xl p-4 transition-all duration-200 shadow-none cursor-pointer active:scale-[0.99] flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-cyan-400 text-lg shrink-0 shadow-none group-hover:border-cyan-800/60 transition-colors">
                            💧
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                              💧 Wasser- &amp; TDS-Rechner
                            </h4>
                            <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                              Gießwasser-Härtegrad &amp; TDS-Grenzwerte (&lt; 50 ppm) prüfen oder Verschnitt berechnen.
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>

                      {/* Kachel 2: 🪴 Substrat-Rechner */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          triggerHaptic('subtle');
                          setSettingsSubView('substrate_calc');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            triggerHaptic('subtle');
                            setSettingsSubView('substrate_calc');
                          }
                        }}
                        className="group bg-zinc-950 border border-zinc-900 hover:border-zinc-800 rounded-2xl p-4 transition-all duration-200 shadow-none cursor-pointer active:scale-[0.99] flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 text-lg shrink-0 shadow-none group-hover:border-emerald-800/60 transition-colors">
                            🪴
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                              🪴 Substrat-Rechner
                            </h4>
                            <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                              Exakte Mischungsverhältnisse für Weißtorf, Quarzsand und Perlite pro Topfvolumen.
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>

                      {/* Kachel 3: 🪲 Fütterungs- & Schädlings-Guide */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          triggerHaptic('subtle');
                          setSettingsSubView('pest_guide');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            triggerHaptic('subtle');
                            setSettingsSubView('pest_guide');
                          }
                        }}
                        className="group bg-zinc-950 border border-zinc-900 hover:border-zinc-800 rounded-2xl p-4 transition-all duration-200 shadow-md cursor-pointer active:scale-[0.99] flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 text-lg shrink-0 shadow-inner group-hover:border-amber-800/60 transition-colors">
                            🪲
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                              🪲 Fütterungs- &amp; Schädlings-Guide
                            </h4>
                            <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">
                              Sichere Fütterungsmethoden, Beutetypen und biologische Hilfe gegen Trauermücken &amp; Läuse.
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SUBVIEW 2: DETAIL-ANSICHT "💧 Wasser- & TDS-Rechner" */}
              {settingsSubView === 'water_calc' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('subtle');
                      setSettingsSubView('main');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 px-3 py-1.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>← Zurück zu Einstellungen</span>
                  </button>

                  <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 space-y-4 shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-cyan-400 text-lg shrink-0">
                        💧
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          💧 Wasser- &amp; TDS-Rechner
                        </h3>
                        <p className="text-[11px] text-zinc-400">
                          Prüfung des Leitwerts (ppm) &amp; Verschnitt-Berechnung
                        </p>
                      </div>
                    </div>

                    {/* Teil 1: Eingabe-Möglichkeiten (Option A & Option B) & Dynamische Auswertung */}
                    <div className="bg-zinc-900/80 border border-zinc-850 rounded-xl p-3.5 space-y-4">
                      {/* Option A: Direkte Zahlen-Eingabe des Leitwerts/TDS-Werts in PPM */}
                      <div className="space-y-1.5">
                        <label htmlFor="direct-tds-input" className="text-xs font-semibold text-zinc-200 flex items-center justify-between">
                          <span>Direkte Zahlen-Eingabe (PPM)</span>
                          <span className="text-[11px] font-mono text-emerald-400">
                            Aktuell: {tdsInput} PPM
                          </span>
                        </label>
                        <div className="relative">
                          <input
                            id="direct-tds-input"
                            type="number"
                            min="0"
                            max="1000"
                            value={tdsInput === 0 ? '' : tdsInput}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                              setTdsInput(val);
                            }}
                            placeholder="z. B. 35"
                            className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 focus:outline-none rounded-xl p-3 text-sm text-white font-mono placeholder:text-zinc-600 transition-colors pr-14"
                          />
                          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-500 pointer-events-none">
                            PPM
                          </span>
                        </div>

                        {/* Schieberegler zur stufenlosen Justierung */}
                        <div className="pt-1.5 space-y-1">
                          <input
                            type="range"
                            min="0"
                            max="300"
                            value={Math.min(300, tdsInput)}
                            onChange={(e) => setTdsInput(Number(e.target.value))}
                            className="w-full accent-emerald-500 cursor-pointer"
                          />
                          <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                            <span>0 PPM (Destilliert)</span>
                            <span>50 PPM (Ideal-Grenze)</span>
                            <span>100 PPM (Amber)</span>
                            <span>&gt;100 PPM (Kritisch)</span>
                          </div>
                        </div>
                      </div>

                      {/* Option B: Quick-Buttons für Wasserquellen */}
                      <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                        <label className="text-xs font-semibold text-zinc-300 block">
                          Quick-Buttons für Wasserquellen:
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('subtle');
                              setTdsInput(15);
                            }}
                            className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex items-center justify-between ${
                              tdsInput === 15
                                ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300 shadow-sm'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-850 hover:border-zinc-700'
                            }`}
                          >
                            <span>Regenwasser (~15 PPM)</span>
                            {tdsInput === 15 && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('subtle');
                              setTdsInput(0);
                            }}
                            className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex items-center justify-between ${
                              tdsInput === 0
                                ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300 shadow-sm'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-850 hover:border-zinc-700'
                            }`}
                          >
                            <span>Destilliertes Wasser (0 PPM)</span>
                            {tdsInput === 0 && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('subtle');
                              setTdsInput(80);
                            }}
                            className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex items-center justify-between ${
                              tdsInput === 80
                                ? 'bg-amber-950/70 border-amber-600 text-amber-300 shadow-sm'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-850 hover:border-zinc-700'
                            }`}
                          >
                            <span>Leitungswasser Weich (~80 PPM)</span>
                            {tdsInput === 80 && <Check className="w-3.5 h-3.5 text-amber-400" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('subtle');
                              setTdsInput(280);
                            }}
                            className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex items-center justify-between ${
                              tdsInput === 280 || tdsInput > 250
                                ? 'bg-red-950/70 border-red-600 text-red-300 shadow-sm'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-850 hover:border-zinc-700'
                            }`}
                          >
                            <span>Leitungswasser Hart (&gt;250 PPM)</span>
                            {(tdsInput === 280 || tdsInput > 250) && <Check className="w-3.5 h-3.5 text-red-400" />}
                          </button>
                        </div>
                      </div>

                      {/* Dynamische Auswertung (Bewertungs-Kachel) */}
                      {(() => {
                        if (tdsInput < 50) {
                          return (
                            <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-800/60 text-emerald-300 space-y-1.5 shadow-md animate-in fade-in duration-150">
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-emerald-900/60 border border-emerald-700 px-2.5 py-0.5 rounded-full text-emerald-200">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                  &lt; 50 PPM
                                </span>
                                <span className="text-[11px] font-mono font-bold text-emerald-400">
                                  {tdsInput} PPM
                                </span>
                              </div>
                              <p className="text-xs font-bold text-emerald-100 leading-snug">
                                Ideal: Keine Mineralienansammlung. Gefahrlos zum Anstauen.
                              </p>
                              <p className="text-[11px] text-emerald-300/90 leading-relaxed border-t border-emerald-800/60 pt-1.5">
                                Dieses Wasser schützt die empfindlichen Wurzeln vor Versalzung und osmotischem Schock. Optimal für alle fleischfressenden Pflanzen.
                              </p>
                            </div>
                          );
                        }

                        if (tdsInput <= 100) {
                          return (
                            <div className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-800/60 text-amber-300 space-y-1.5 shadow-md animate-in fade-in duration-150">
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-amber-900/60 border border-amber-700 px-2.5 py-0.5 rounded-full text-amber-200">
                                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                                  50 - 100 PPM
                                </span>
                                <span className="text-[11px] font-mono font-bold text-amber-400">
                                  {tdsInput} PPM
                                </span>
                              </div>
                              <p className="text-xs font-bold text-amber-100 leading-snug">
                                Akzeptabel: Regelmäßiges Substratspülen empfohlen.
                              </p>
                              <p className="text-[11px] text-amber-300/90 leading-relaxed border-t border-amber-800/60 pt-1.5">
                                Mineralien reichern sich allmählich im Torf an. Spüle das Substrat regelmäßig alle 2–4 Wochen mit reinem Regen- oder Destilliertwasser durch.
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="p-3.5 rounded-xl bg-red-950/70 border border-red-800/60 text-red-300 space-y-1.5 shadow-md animate-in fade-in duration-150">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-red-900/60 border border-red-700 px-2.5 py-0.5 rounded-full text-red-200">
                                <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                                &gt; 100 PPM
                              </span>
                              <span className="text-[11px] font-mono font-bold text-red-400">
                                {tdsInput} PPM
                              </span>
                            </div>
                            <p className="text-xs font-bold text-red-100 leading-snug">
                              Kritisch: Gefahr von Wurzelbrand! Substrat sofort spülen &amp; auf Destilliertes/Regenwasser umstellen.
                            </p>
                            <p className="text-[11px] text-red-300/90 leading-relaxed border-t border-red-800/60 pt-1.5">
                              Gelöste Härtebildner und Salze vergiften das saure Moormilieu. Die Wurzeln verbrennen und Fangblätter sterben schwarz ab.
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Teil 2: Verschnitt-Rechner */}
                    <div className="bg-zinc-900/80 border border-zinc-850 rounded-xl p-3.5 space-y-3">
                      <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        Verschnitt-Rechner (Leitung + Reinstwasser)
                      </h4>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="text-[11px] text-zinc-400 block mb-1">Ziel-TDS (ppm)</label>
                          <input
                            type="number"
                            value={targetTds}
                            onChange={(e) => setTargetTds(Math.max(1, Number(e.target.value)))}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-zinc-400 block mb-1">Gesamtmenge (Liter)</label>
                          <input
                            type="number"
                            value={totalWaterLiters}
                            onChange={(e) => setTotalWaterLiters(Math.max(0.5, Number(e.target.value)))}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white font-mono"
                          />
                        </div>
                      </div>

                      {(() => {
                        const clampedTarget = Math.max(pureWaterTds, Math.min(tapTds, targetTds));
                        const fractionPure = tapTds > pureWaterTds ? (tapTds - clampedTarget) / (tapTds - pureWaterTds) : 1;
                        const pureLiters = (totalWaterLiters * fractionPure);
                        const tapLiters = (totalWaterLiters - pureLiters);

                        return (
                          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
                            <div className="text-xs text-zinc-300 font-medium">
                              Benötigte Mischung für {totalWaterLiters} L Wasser ({targetTds} ppm):
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-center">
                              <div className="p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/40">
                                <span className="text-[10px] text-cyan-400 block uppercase font-mono">Osmose / Regen</span>
                                <span className="text-sm font-bold text-cyan-200">{pureLiters.toFixed(2)} L</span>
                              </div>
                              <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
                                <span className="text-[10px] text-zinc-400 block uppercase font-mono">Leitungswasser</span>
                                <span className="text-sm font-bold text-zinc-200">{tapLiters.toFixed(2)} L</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Wichtige Wasser-Garantie */}
                    <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-850 text-[11px] text-zinc-400 space-y-1.5 leading-relaxed">
                      <p className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        Wichtige Regel für Britta-Filter:
                      </p>
                      <p>
                        Kannenfilter tauschen Kalk gegen Natrium-Ionen aus. Natrium verbrennt fleischfressende Pflanzen noch schneller! Nutze ausschließlich Regen-, Umkehrosmose- oder destilliertes Wasser.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* SUBVIEW 3: DETAIL-ANSICHT "🪴 Substrat-Rechner" */}
              {settingsSubView === 'substrate_calc' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('subtle');
                      setSettingsSubView('main');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 px-3 py-1.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>← Zurück zu Einstellungen</span>
                  </button>

                  <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 space-y-4 shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 text-lg shrink-0">
                        🪴
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          🪴 Substrat-Mengenrechner
                        </h3>
                        <p className="text-[11px] text-zinc-400">
                          Exakte Mischungsverhältnisse &amp; Rezeptur pro Topfvolumen
                        </p>
                      </div>
                    </div>

                    {/* 1. Dropdown Pflanzenart */}
                    <div className="space-y-1.5">
                      <label htmlFor="substrate-plant-dropdown" className="text-xs font-semibold text-zinc-200 block">
                        Pflanzenart &amp; Substrat-Rezeptur:
                      </label>
                      <div className="relative">
                        <select
                          id="substrate-plant-dropdown"
                          value={substrateProfile}
                          onChange={(e) => {
                            triggerHaptic('subtle');
                            setSubstrateProfile(e.target.value as 'classic' | 'nepenthes' | 'drosera');
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 focus:outline-none rounded-xl p-3 text-xs text-zinc-100 font-medium transition-colors appearance-none cursor-pointer pr-10"
                        >
                          <option value="classic">Standard Karnivoren-Mix (Dionaea/Sarracenia)</option>
                          <option value="drosera">Sonnentau-Spezial (Drosera)</option>
                          <option value="nepenthes">Epiphytisch (Nepenthes)</option>
                        </select>
                        <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      {/* Quick-Auswahl-Buttons */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic('subtle');
                            setSubstrateProfile('classic');
                          }}
                          className={`p-2 rounded-xl border text-left text-[11px] transition-all cursor-pointer ${
                            substrateProfile === 'classic'
                              ? 'bg-emerald-950/70 border-emerald-600 text-emerald-200 font-semibold shadow-sm'
                              : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>Standard Mix</span>
                            {substrateProfile === 'classic' && <Check className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <span className="text-[10px] text-zinc-500 block">Dionaea &amp; Sarracenia</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic('subtle');
                            setSubstrateProfile('drosera');
                          }}
                          className={`p-2 rounded-xl border text-left text-[11px] transition-all cursor-pointer ${
                            substrateProfile === 'drosera'
                              ? 'bg-emerald-950/70 border-emerald-600 text-emerald-200 font-semibold shadow-sm'
                              : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>Sonnentau-Spezial</span>
                            {substrateProfile === 'drosera' && <Check className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <span className="text-[10px] text-zinc-500 block">Drosera &amp; Pinguicula</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic('subtle');
                            setSubstrateProfile('nepenthes');
                          }}
                          className={`p-2 rounded-xl border text-left text-[11px] transition-all cursor-pointer ${
                            substrateProfile === 'nepenthes'
                              ? 'bg-emerald-950/70 border-emerald-600 text-emerald-200 font-semibold shadow-sm'
                              : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>Epiphytisch</span>
                            {substrateProfile === 'nepenthes' && <Check className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <span className="text-[10px] text-zinc-500 block">Nepenthes / Kannen</span>
                        </button>
                      </div>
                    </div>

                    {/* 2. Topfvolumen in Liter (Slider & Number-Input) */}
                    <div className="bg-zinc-900/80 border border-zinc-850 rounded-xl p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <label htmlFor="substrate-volume-input" className="text-xs font-semibold text-zinc-200">
                          Topfvolumen in Liter:
                        </label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-zinc-950 border border-zinc-800 text-emerald-400">
                            {substrateVolume} Liter
                          </span>
                        </div>
                      </div>

                      {/* Number-Input & Quick-Pills */}
                      <div className="space-y-2">
                        <div className="relative">
                          <input
                            id="substrate-volume-input"
                            type="number"
                            min="0.5"
                            max="100"
                            step="0.5"
                            value={substrateVolume}
                            onChange={(e) => {
                              const val = Math.max(0.5, parseFloat(e.target.value) || 0.5);
                              setSubstrateVolume(val);
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 focus:outline-none rounded-xl p-2.5 text-xs text-white font-mono placeholder:text-zinc-600 transition-colors pr-14"
                            placeholder="z. B. 3"
                          />
                          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-500 pointer-events-none">
                            Liter
                          </span>
                        </div>

                        {/* Slider für stufenlose Haptik */}
                        <div className="pt-1 space-y-1">
                          <input
                            type="range"
                            min="0.5"
                            max="30"
                            step="0.5"
                            value={Math.min(30, substrateVolume)}
                            onChange={(e) => setSubstrateVolume(Number(e.target.value))}
                            className="w-full accent-emerald-500 cursor-pointer"
                          />
                          <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                            <span>0.5 L (Kompakt)</span>
                            <span>3.0 L (Standardtopf)</span>
                            <span>10 L (Ampel)</span>
                            <span>30 L (Moorkübel)</span>
                          </div>
                        </div>

                        {/* Quick-Buttons für typische Topfvolumina */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          {[1, 2, 3, 5, 10, 25].map((liters) => (
                            <button
                              key={liters}
                              type="button"
                              onClick={() => {
                                triggerHaptic('subtle');
                                setSubstrateVolume(liters);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer border transition-all ${
                                substrateVolume === liters
                                  ? 'bg-emerald-500 text-black border-emerald-400 font-bold shadow-sm'
                                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'
                              }`}
                            >
                              {liters} L
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 3. Automatische Berechnung & Rezept-Ausgabe mit Dosierungs-Kacheln */}
                    {(() => {
                      interface IngredientInfo {
                        name: string;
                        percentage: number;
                        percentageLabel: string;
                        liters: number;
                        colorClass: string;
                        borderClass: string;
                        badgeClass: string;
                        icon: string;
                        hint: string;
                      }

                      let recipeTitle = '';
                      let recipeDescription = '';
                      let ingredients: IngredientInfo[] = [];

                      if (substrateProfile === 'classic') {
                        // Für Standard: 66% ungedüngter Weißtorf (z.B. 2.0 L bei 3 L) + 33% Perlite/Quarzsand (z.B. 1.0 L bei 3 L)
                        const torfL = substrateVolume === 3 ? 2.0 : Number((substrateVolume * 0.66).toFixed(2));
                        const perliteL = substrateVolume === 3 ? 1.0 : Number((substrateVolume * 0.33).toFixed(2));

                        recipeTitle = 'Standard Karnivoren-Mix (Dionaea/Sarracenia)';
                        recipeDescription = '66% ungedüngter Weißtorf + 33% Perlite / Quarzsand. Bewährtes Moormilieu für Anstaukultur.';

                        ingredients = [
                          {
                            name: 'Ungedüngter Weißtorf',
                            percentage: 66,
                            percentageLabel: '66%',
                            liters: torfL,
                            colorClass: 'text-amber-300',
                            borderClass: 'border-amber-800/60 bg-amber-950/30',
                            badgeClass: 'bg-amber-950 border-amber-700 text-amber-300',
                            icon: '🪵',
                            hint: 'Zersetzungsgrad H2–H5, pH 2.5–3.5, strikt ohne Düngerzusatz.',
                          },
                          {
                            name: 'Perlite / Quarzsand',
                            percentage: 33,
                            percentageLabel: '33%',
                            liters: perliteL,
                            colorClass: 'text-cyan-300',
                            borderClass: 'border-cyan-800/60 bg-cyan-950/30',
                            badgeClass: 'bg-cyan-950 border-cyan-700 text-cyan-300',
                            icon: '⚪',
                            hint: 'Kalkfreier Quarzsand (0.5–2 mm) oder gewaschene Perlite zur Belüftung.',
                          },
                        ];
                      } else if (substrateProfile === 'nepenthes') {
                        // Für Nepenthes: 40% Torf + 30% Pinienrinde + 30% Perlite
                        const torfL = substrateVolume === 3 ? 1.2 : Number((substrateVolume * 0.40).toFixed(2));
                        const rindeL = substrateVolume === 3 ? 0.9 : Number((substrateVolume * 0.30).toFixed(2));
                        const perliteL = substrateVolume === 3 ? 0.9 : Number((substrateVolume * 0.30).toFixed(2));

                        recipeTitle = 'Epiphytisch (Nepenthes)';
                        recipeDescription = '40% Torf + 30% Pinienrinde + 30% Perlite. Extrem luftdurchlässig für sauerstoffhungrige Wurzeln.';

                        ingredients = [
                          {
                            name: 'Ungedüngter Torf / Sphagnum',
                            percentage: 40,
                            percentageLabel: '40%',
                            liters: torfL,
                            colorClass: 'text-amber-300',
                            borderClass: 'border-amber-800/60 bg-amber-950/30',
                            badgeClass: 'bg-amber-950 border-amber-700 text-amber-300',
                            icon: '🪵',
                            hint: 'Feuchtigkeitsspeicher, ungedüngt (oder lebendes/getrocknetes Sphagnum).',
                          },
                          {
                            name: 'Pinienrinde (mittlere Körnung)',
                            percentage: 30,
                            percentageLabel: '30%',
                            liters: rindeL,
                            colorClass: 'text-emerald-300',
                            borderClass: 'border-emerald-800/60 bg-emerald-950/30',
                            badgeClass: 'bg-emerald-950 border-emerald-700 text-emerald-300',
                            icon: '🌲',
                            hint: 'Körnung 5–15 mm. Schafft stabile Wurzel-Hohlräume und Drainage.',
                          },
                          {
                            name: 'Perlite (grob)',
                            percentage: 30,
                            percentageLabel: '30%',
                            liters: perliteL,
                            colorClass: 'text-cyan-300',
                            borderClass: 'border-cyan-800/60 bg-cyan-950/30',
                            badgeClass: 'bg-cyan-950 border-cyan-700 text-cyan-300',
                            icon: '⚪',
                            hint: 'Kalkfrei gewaschen, verhindert Verdichtung & Wurzelfäule.',
                          },
                        ];
                      } else {
                        // Für Drosera: 70% ungedüngter Weißtorf + 30% feiner Quarzsand
                        const torfL = substrateVolume === 3 ? 2.1 : Number((substrateVolume * 0.70).toFixed(2));
                        const sandL = substrateVolume === 3 ? 0.9 : Number((substrateVolume * 0.30).toFixed(2));

                        recipeTitle = 'Sonnentau-Spezial (Drosera)';
                        recipeDescription = '70% ungedüngter Weißtorf + 30% feiner Quarzsand (0.5–1.5mm) für optimale Kapilarkraft.';

                        ingredients = [
                          {
                            name: 'Ungedüngter Weißtorf',
                            percentage: 70,
                            percentageLabel: '70%',
                            liters: torfL,
                            colorClass: 'text-amber-300',
                            borderClass: 'border-amber-800/60 bg-amber-950/30',
                            badgeClass: 'bg-amber-950 border-amber-700 text-amber-300',
                            icon: '🪵',
                            hint: 'Hohe Wasserhaltekraft für feuchte Moor-Standorte.',
                          },
                          {
                            name: 'Feiner Quarzsand (0.5–1.5mm)',
                            percentage: 30,
                            percentageLabel: '30%',
                            liters: sandL,
                            colorClass: 'text-cyan-300',
                            borderClass: 'border-cyan-800/60 bg-cyan-950/30',
                            badgeClass: 'bg-cyan-950 border-cyan-700 text-cyan-300',
                            icon: '🏖️',
                            hint: 'Strikt kalkfreier, mehrfach gewaschener Aquariensand.',
                          },
                        ];
                      }

                      return (
                        <div className="bg-zinc-900 border border-zinc-850 rounded-xl p-3.5 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                                Rezeptur für {substrateVolume} Liter Topfvolumen:
                              </h4>
                              <p className="text-[11px] text-zinc-400 mt-0.5">
                                {recipeDescription}
                              </p>
                            </div>
                          </div>

                          {/* Visueller Mischungs-Balken */}
                          <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-zinc-950 border border-zinc-800">
                            {ingredients.map((ing) => (
                              <div
                                key={ing.name}
                                style={{ width: `${ing.percentage}%` }}
                                className={`h-full transition-all duration-300 ${
                                  ing.name.includes('Torf')
                                    ? 'bg-amber-600'
                                    : ing.name.includes('Rinde')
                                    ? 'bg-emerald-600'
                                    : 'bg-cyan-500'
                                }`}
                                title={`${ing.name}: ${ing.percentageLabel}`}
                              />
                            ))}
                          </div>

                          {/* Dosierungs-Kacheln */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {ingredients.map((ing) => (
                              <div
                                key={ing.name}
                                className={`rounded-xl border p-3 flex flex-col justify-between space-y-2 shadow-sm ${ing.borderClass}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{ing.icon}</span>
                                    <span className="text-xs font-semibold text-zinc-200">
                                      {ing.name}
                                    </span>
                                  </div>
                                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${ing.badgeClass}`}>
                                    {ing.percentageLabel}
                                  </span>
                                </div>

                                <div className="flex items-baseline justify-between pt-1 border-t border-zinc-800/60">
                                  <span className="text-[11px] text-zinc-400">Dosierung:</span>
                                  <span className={`text-base font-mono font-extrabold ${ing.colorClass}`}>
                                    {ing.liters.toFixed(1)} Liter
                                  </span>
                                </div>

                                <p className="text-[10px] text-zinc-400 leading-tight">
                                  {ing.hint}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Substrat-Regeln */}
                    <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-850 text-[11px] text-zinc-400 space-y-1.5 leading-relaxed">
                      <p className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        Goldene Substrat-Regel:
                      </p>
                      <p>
                        Ausschließlich 100% ungedüngten Hochmoortorf (Weißtorf) mit pH 2.5–3.5 verwenden. Niemals normale Blumenerde, Kompost oder organischen Gartendünger beimischen – das salzt das Moormilieu sofort irreversibel auf!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* SUBVIEW 4: DETAIL-ANSICHT "🪲 Fütterungs- & Schädlings-Guide" */}
              {settingsSubView === 'pest_guide' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('subtle');
                      setSettingsSubView('main');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 px-3 py-1.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>← Zurück zu Einstellungen</span>
                  </button>

                  <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 space-y-4 shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-850 flex items-center justify-center text-amber-400 text-lg shrink-0">
                        🪲
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          🪲 Fütterungs- &amp; Schädlings-Guide
                        </h3>
                        <p className="text-[11px] text-zinc-400">
                          Kompakte Wissens-Kacheln für artgerechte Ernährung &amp; sicheren Pflanzenschutz
                        </p>
                      </div>
                    </div>

                    {/* Guide Filter-Tabs */}
                    <div className="flex rounded-xl bg-zinc-900 p-1 border border-zinc-850">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic('subtle');
                          setGuideTab('feeding');
                        }}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          guideTab === 'feeding'
                            ? 'bg-zinc-800 text-emerald-400 shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        🍽️ Fütterung &amp; Nährstoffe
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic('subtle');
                          setGuideTab('pests');
                        }}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          guideTab === 'pests'
                            ? 'bg-zinc-800 text-amber-400 shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        🛡️ Schädlingsbekämpfung
                      </button>
                    </div>

                    {/* Kachel 1: "Fütterung & Nährstoffe" */}
                    {(guideTab === 'feeding') && (
                      <div className="space-y-3.5 animate-in fade-in duration-150">
                        <div className="bg-zinc-900/90 border border-zinc-850 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base">🍽️</span>
                              <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                                Kachel: Fütterung &amp; Nährstoffe
                              </h4>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-800 text-emerald-300">
                              Artgerecht
                            </span>
                          </div>

                          {/* Wichtige Warnung */}
                          <div className="p-3 rounded-xl bg-red-950/70 border border-red-800/70 text-red-200 space-y-1 shadow-sm">
                            <div className="flex items-center gap-2 text-xs font-bold text-red-100">
                              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                              <span>Wichtige Warnung:</span>
                            </div>
                            <p className="text-xs leading-relaxed font-semibold text-red-200 pl-6">
                              „Niemals rohes Fleisch, Käse oder Dünger verwenden (führt zu Fallen-Fäulnis!).“
                            </p>
                            <p className="text-[11px] text-red-300/80 leading-relaxed pl-6 pt-0.5">
                              Fett und Proteine herkömmlicher Lebensmittel überfordern die Verdauungsenzyme der Pflanzen völlig. Die Falle verfault innerhalb weniger Tage und stirbt schwarz ab.
                            </p>
                          </div>

                          {/* Tipp */}
                          <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-800/70 text-emerald-200 space-y-1 shadow-sm">
                            <div className="flex items-center gap-2 text-xs font-bold text-emerald-100">
                              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span>Praxistipp:</span>
                            </div>
                            <p className="text-xs leading-relaxed font-semibold text-emerald-200 pl-6">
                              „Pflanzen im Freiland fangen selbstständig genug. Für Zimmerkultur: Fischfutter-Flocken auf Sonnentau-Minkeln vorsichtig anfeuchten.“
                            </p>
                            <p className="text-[11px] text-emerald-300/80 leading-relaxed pl-6 pt-0.5">
                              Ein winziger Krümel angefeuchtetes Fischfutter oder getrocknete Mückenlarven alle 3–4 Wochen stimuliert die Tentakel sanft, ohne das Blatt zu belasten.
                            </p>
                          </div>

                          {/* Vertiefende Regeln für Zimmerkultur */}
                          <div className="space-y-2 pt-1">
                            <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300 space-y-1">
                              <span className="font-bold text-emerald-400">Venusfliegenfalle (Dionaea muscipula):</span>
                              <p className="text-zinc-400 leading-relaxed">
                                Nur lebende Beute füttern oder leblose Insekten mit einem dünnen Borstenpinsel/Zahnstocher leicht bewegen, um die Triggerhaare mehrfach zu reizen. Max. 1 Falle pro Pflanze gleichzeitig!
                              </p>
                            </div>

                            <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300 space-y-1">
                              <span className="font-bold text-cyan-400">Kannenpflanzen (Nepenthes):</span>
                              <p className="text-zinc-400 leading-relaxed">
                                Flüssigkeit in den Kannen niemals ausleeren. Falls eine Kanne austrocknet, nur wenige Tropfen Reinstwasser zugeben – niemals Mineraldünger hineingießen.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Kachel 2: "Schädlingsbekämpfung" */}
                    {(guideTab === 'pests') && (
                      <div className="space-y-3.5 animate-in fade-in duration-150">
                        <div className="bg-zinc-900/90 border border-zinc-850 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base">🛡️</span>
                              <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                                Kachel: Schädlingsbekämpfung
                              </h4>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-800 text-amber-300">
                              Karnivoren-sicher
                            </span>
                          </div>

                          {/* Häufige Schädlinge Badge-Box */}
                          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-zinc-200">
                                Häufige Schädlinge:
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-950/80 border border-amber-700 text-amber-300">
                                  Blattläuse
                                </span>
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-950/80 border border-amber-700 text-amber-300">
                                  Trauermücken
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                              Feuchtes Moormilieu lockt Trauermücken an; trocken-warme Zimmerluft begünstigt Blattläuse an zarten Neuaustrieben.
                            </p>
                          </div>

                          {/* Karnivoren-sichere Behandlung Warnung & Handlungsanweisung */}
                          <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-800/80 text-amber-200 space-y-2 shadow-sm">
                            <div className="flex items-center gap-2 text-xs font-bold text-amber-100">
                              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                              <span>Karnivoren-sichere Behandlung:</span>
                            </div>
                            <p className="text-xs leading-relaxed font-semibold text-amber-100 pl-6">
                              „Keine ölhaltigen Spritzmittel (verkleben die Fallen!). Nutze Raubmilben, Lizetan-Stäbchen oder Nützlinge (Nematoden).“
                            </p>
                            <p className="text-[11px] text-amber-300/80 leading-relaxed pl-6">
                              Ölfilme (wie Rapsöl- oder Paraffinölpräparate) verstopfen die feinen Drüsen und Atmungsöffnungen der Fangblätter dauerhaft.
                            </p>
                          </div>

                          {/* Gezielte Maßnahmen nach Schädling */}
                          <div className="space-y-2 pt-1 text-xs">
                            {/* Blattläuse */}
                            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/90 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-amber-400">Blattläuse wirksam bekämpfen:</span>
                                <span className="text-[10px] text-zinc-500 font-mono">Tauchbad-Methode</span>
                              </div>
                              <p className="text-zinc-300 text-[11px] leading-relaxed">
                                <strong>Das 24h-Tauchbad:</strong> Die gesamte Pflanze samt Topf 24 Stunden vollständig in Regen- oder Destilliertwasser untertauchen. Die Läuse ersticken zuverlässig, während Moorpflanzen den Sauerstoffmangel problemlos überstehen. Alternativ Lizetan-Stäbchen im Substrat oder Raubmilben.
                              </p>
                            </div>

                            {/* Trauermücken */}
                            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/90 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-cyan-400">Trauermücken biologisch tilgen:</span>
                                <span className="text-[10px] text-zinc-500 font-mono">Nützlinge</span>
                              </div>
                              <p className="text-zinc-300 text-[11px] leading-relaxed">
                                <strong>SF-Nematoden (Steinernema feltiae):</strong> Einfach mit kalkfreiem Gießwasser ausbringen. Die Nützlinge parasitieren die Larven im Moortorf. Zusätzlich Gelbtafeln aufstellen und Sonnentau-Pflanzen (Drosera) als natürliche Fangbarriere nutzen.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ========================================================
            NAVIGATION (Bottom-Bar: Ebene 2: Surface-Container-High & Ambient Shadow)
           ======================================================== */}
        <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-[var(--md-sys-color-surface-container-high)]/95 border-t border-[var(--md-sys-color-outline-variant)] backdrop-blur-md z-30 px-6 py-2 shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)]">
          <div className="flex items-center justify-around">
            {/* Tab 1: Meine Pflanzen */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('subtle');
                setActiveTab('plants');
              }}
              className={`flex flex-col items-center gap-1 text-xs font-medium transition-colors py-1 px-3 rounded-xl cursor-pointer ${
                activeTab === 'plants'
                  ? 'text-[var(--md-sys-color-primary)] font-semibold'
                  : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <div className="relative">
                <Layers className={`w-5 h-5 ${activeTab === 'plants' ? 'stroke-2 text-[var(--md-sys-color-primary)]' : 'stroke-[1.75]'}`} />
                {plants.length > 0 && (
                  <span className="absolute -top-1 -right-2 text-[9px] font-medium w-3.5 h-3.5 rounded-full flex items-center justify-center bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)]">
                    {plants.length}
                  </span>
                )}
              </div>
              <span className={`tracking-tight text-[11px] ${activeTab === 'plants' ? 'text-[var(--md-sys-color-primary)] font-semibold' : 'text-[var(--md-sys-color-on-surface-variant)]'}`}>
                Meine Pflanzen
              </span>
              {activeTab === 'plants' && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)]" />
              )}
            </button>

            {/* Tab 2: KI-Scanner */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('subtle');
                setActiveTab('scanner');
              }}
              className={`flex flex-col items-center gap-1 text-xs font-medium transition-colors py-1 px-3 rounded-xl cursor-pointer ${
                activeTab === 'scanner'
                  ? 'text-[var(--md-sys-color-primary)] font-semibold'
                  : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <div className="relative">
                <Camera className={`w-5 h-5 ${activeTab === 'scanner' ? 'stroke-2 text-[var(--md-sys-color-primary)]' : 'stroke-[1.75]'}`} />
                <span className="absolute -top-1 -right-2 bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)] text-[8px] font-mono px-1 rounded-full">
                  AI
                </span>
              </div>
              <span className={`tracking-tight text-[11px] ${activeTab === 'scanner' ? 'text-[var(--md-sys-color-primary)] font-semibold' : 'text-[var(--md-sys-color-on-surface-variant)]'}`}>
                KI-Scanner
              </span>
              {activeTab === 'scanner' && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)]" />
              )}
            </button>

            {/* Tab 3: Einstellungen */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('subtle');
                setActiveTab('settings');
              }}
              className={`flex flex-col items-center gap-1 text-xs font-medium transition-colors py-1 px-3 rounded-xl cursor-pointer ${
                activeTab === 'settings'
                  ? 'text-[var(--md-sys-color-primary)] font-semibold'
                  : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
              }`}
            >
              <div className="relative">
                <Settings className={`w-5 h-5 ${activeTab === 'settings' ? 'stroke-2 text-[var(--md-sys-color-primary)]' : 'stroke-[1.75]'}`} />
              </div>
              <span className={`tracking-tight text-[11px] ${activeTab === 'settings' ? 'text-[var(--md-sys-color-primary)] font-semibold' : 'text-[var(--md-sys-color-on-surface-variant)]'}`}>
                Einstellungen
              </span>
              {activeTab === 'settings' && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)]" />
              )}
            </button>
          </div>
        </nav>

        {/* ========================================================
            MODAL ("Pflanze hinzufügen" - Ebene 2: Surface-Container-High & Ambient Shadow)
           ======================================================== */}
        {isModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={handleCloseModal}
          >
            <div
              className="w-full max-w-md bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] rounded-[28px] p-5 md:p-6 text-[var(--md-sys-color-on-surface)] relative backdrop-blur-md shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--md-sys-color-outline-variant)] mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0 shadow-none">
                    <Leaf className="w-4 h-4 stroke-[1.8]" />
                  </div>
                  <h3 className="font-bold text-base text-[var(--md-sys-color-on-surface)]">
                    Pflanze hinzufügen
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] p-1.5 rounded-xl hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors cursor-pointer"
                  aria-label="Modal schließen (ESC)"
                  title="Schließen (ESC)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Error Notice */}
              {formError && (
                <div className="mb-4 p-2.5 rounded-xl bg-red-950/40 border border-red-900/60 text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Dezenter Hinweis-Banner bei Inkompatibilität (Moorbeet-Gefahr) */}
              {(incompatibilityWarning || checkPlantIncompatibility(formData.species, plants)) && (
                <div className="mb-4 p-3.5 rounded-xl bg-amber-950/60 border border-amber-800/80 text-amber-200 text-xs space-y-2 animate-in fade-in duration-200 shadow-none">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="font-semibold text-amber-100 leading-snug">
                        ⚠️ Hinweis zur Zusammenstellung: Nepenthes hat abweichende Licht- und Wasserbedürfnisse. Halte sie nicht im selben Anstau-Untersetzer wie Dionaea oder Sarracenia!
                      </p>
                      <p className="text-[11px] text-amber-300/80 leading-relaxed">
                        Moorbeet-Regel: Nepenthes (Kannenpflanze) verträgt keine direkte Prallsonne, keine kalte Überwinterung und keine dauerhafte Staunässe, während Dionaea muscipula und Sarracenia volle Prallsonne, Anstauwasser und kalte Winterruhe benötigen.
                      </p>
                    </div>
                  </div>
                  {isSavedWithWarning && (
                    <div className="flex items-center justify-between pt-2 border-t border-amber-800/50 mt-1">
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Pflanze gespeichert!
                      </span>
                      <button
                        type="button"
                        onClick={handleCloseModal}
                        className="px-3 py-1 bg-amber-900/80 hover:bg-amber-800 text-amber-100 border border-amber-700 font-medium rounded-lg text-xs transition-colors cursor-pointer"
                      >
                        Verstanden &amp; Schließen
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Form with fields: name, species, zipCode */}
              <form onSubmit={handleSavePlant} className="space-y-4">
                {/* Field 1: Name der Pflanze */}
                <div>
                  <label
                    htmlFor={nameInputId}
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Name der Pflanze <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    id={nameInputId}
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="z.B. Venusfliegenfalle Fred"
                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl p-3 text-sm focus:border-emerald-500 focus:outline-none transition-all placeholder:text-zinc-600"
                  />
                </div>

                {/* Field 2: Pflanzenart (Custom Dropdown mit Species-Icons) */}
                <div>
                  <label
                    htmlFor={speciesSelectId}
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Pflanzenart <span className="text-emerald-400">*</span>
                  </label>
                  <div className="relative">
                    <button
                      type="button"
                      id={speciesSelectId}
                      onClick={() => setIsSpeciesDropdownOpen((prev) => !prev)}
                      className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-white rounded-xl p-3 text-sm focus:border-emerald-500 focus:outline-none transition-all flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
                          <SpeciesIcon species={formData.species} className="w-3.5 h-3.5 stroke-[1.8]" />
                        </div>
                        <span className="truncate text-xs font-medium text-zinc-100">
                          {formData.species}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-zinc-400 transition-transform ${
                          isSpeciesDropdownOpen ? 'rotate-180 text-emerald-400' : ''
                        }`}
                      />
                    </button>

                    {isSpeciesDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1.5 bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] rounded-2xl p-1.5 shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)] z-20 space-y-1 animate-in fade-in duration-150">
                        {SPECIES_OPTIONS.map((opt) => {
                          const isSelected = formData.species === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, species: opt.value });
                                setIsSpeciesDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-zinc-900 text-white border border-emerald-800/40'
                                  : 'hover:bg-zinc-900/60 text-zinc-300'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                                    isSelected
                                      ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400'
                                      : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                                  }`}
                                >
                                  <SpeciesIcon species={opt.value} className="w-4 h-4 stroke-[1.8]" />
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-white leading-tight">
                                    {opt.name}
                                  </p>
                                  <p className="text-[10px] text-zinc-500 mt-0.5">
                                    {opt.trapType} • {opt.description}
                                  </p>
                                </div>
                              </div>
                              {isSelected && (
                                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Field 3: Postleitzahl mit Echtzeit-Validierung & Orts-Vorschau */}
                <div>
                  <label
                    htmlFor={zipCodeInputId}
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Postleitzahl <span className="text-emerald-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id={zipCodeInputId}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      value={formData.zipCode}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                        setFormData({ ...formData, zipCode: val });
                      }}
                      placeholder="z.B. 50354"
                      maxLength={5}
                      className={`w-full bg-zinc-900 border text-white rounded-xl p-3 pl-9 pr-9 text-sm focus:outline-none transition-all placeholder:text-zinc-600 ${
                        zipValidation.status === 'valid'
                          ? 'border-emerald-500/80 focus:border-emerald-400'
                          : zipValidation.status === 'invalid'
                          ? 'border-red-500/80 focus:border-red-400'
                          : 'border-zinc-800 focus:border-emerald-500'
                      }`}
                    />
                    <MapPin className="w-4 h-4 text-zinc-500 absolute left-3 top-3.5" />

                    {/* Status-Icon im Input */}
                    <div className="absolute right-3 top-3.5">
                      {zipValidation.status === 'loading' && (
                        <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                      )}
                      {zipValidation.status === 'valid' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-in zoom-in-50 duration-150" />
                      )}
                      {zipValidation.status === 'invalid' && (
                        <AlertTriangle className="w-4 h-4 text-red-400 animate-in zoom-in-50 duration-150" />
                      )}
                    </div>
                  </div>

                  {/* UI-Feedback direkt unter dem Input-Feld */}
                  <div className="mt-1.5 min-h-[18px]">
                    {zipValidation.status === 'loading' && (
                      <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 animate-in fade-in">
                        <Loader2 className="w-3 h-3 text-emerald-400 animate-spin shrink-0" />
                        <span>Ort wird ermittelt...</span>
                      </p>
                    )}

                    {zipValidation.status === 'valid' && (
                      <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5 animate-in fade-in">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>
                          ✓ {formData.zipCode.trim()} {zipValidation.city}{zipValidation.stateCode ? ` (${zipValidation.stateCode})` : ''}
                        </span>
                      </p>
                    )}

                    {zipValidation.status === 'invalid' && (
                      <p className="text-[11px] text-red-400 flex items-center gap-1.5 animate-in fade-in">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span>⚠️ Ungültige deutsche Postleitzahl</span>
                      </p>
                    )}

                    {zipValidation.status === 'idle' && (
                      <p className="text-[10px] text-zinc-500">
                        Ermittelt über Zippopotam & Open-Meteo automatisch die lokale Temperatur & Dormanz.
                      </p>
                    )}
                  </div>
                </div>

                {/* Modal Buttons: Abbrechen & Speichern */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-900 mt-5">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-xl transition-colors cursor-pointer"
                  >
                    {isSavedWithWarning ? 'Schließen' : 'Abbrechen'}
                  </button>

                  {/* "Speichern" CTA / "Fertig" bei Warnung */}
                  {isSavedWithWarning ? (
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="px-5 py-2.5 text-xs bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Fertig</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSubmitting || zipValidation.status !== 'valid' || !formData.name.trim()}
                      title={
                        zipValidation.status !== 'valid'
                          ? 'Bitte gib eine gültige deutsche PLZ ein'
                          : !formData.name.trim()
                          ? 'Bitte gib einen Namen ein'
                          : 'Pflanze speichern'
                      }
                      className="px-5 py-2.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-emerald-400 border border-zinc-800 hover:border-emerald-800/60 font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Wird gespeichert...</span>
                        </>
                      ) : (
                        <span>Speichern</span>
                      )}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================
            PLANT DETAIL BOTTOM-SHEET ("Pflanzen-Akte")
           ======================================================== */}
        {activeDetailPlant && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bottom-sheet-title"
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150 flex items-end justify-center"
            onClick={() => {
              triggerHaptic('subtle');
              setSelectedPlant(null);
            }}
          >
            <div
              className="fixed inset-x-0 bottom-0 z-50 bg-[var(--md-sys-color-surface-container-high)] border-t border-[var(--md-sys-color-outline-variant)] rounded-t-[28px] max-w-md mx-auto p-6 max-h-[85vh] overflow-y-auto animate-slide-up text-[var(--md-sys-color-on-surface)] space-y-4 backdrop-blur-md shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag Handle Bar */}
              <div className="w-12 h-1.5 bg-[var(--md-sys-color-outline-variant)] rounded-full mx-auto -mt-2 mb-2 shrink-0 cursor-pointer" />

              {/* Header: Pflanzenname, Botanischer Name, PLZ und aktuelles Wetter */}
              {(() => {
                const cleanZip = activeDetailPlant.zipCode.trim();
                const weather = weatherMap[cleanZip];
                const temp = weather?.temperature ?? 12;
                const dormancy = getDormancyStatus(activeDetailPlant.species, temp);

                return (
                  <div className="pb-3.5 border-b border-[var(--md-sys-color-outline-variant)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Eingebettete Sub-Kachel: Reinweiß (surface-container-lowest #FFFFFF) */}
                        <div className="w-11 h-11 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0">
                          <SpeciesIcon species={activeDetailPlant.species} className="w-6 h-6 stroke-[1.8]" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 id="bottom-sheet-title" className="font-bold text-lg text-[var(--md-sys-color-on-surface)] truncate leading-tight">
                              {activeDetailPlant.name}
                            </h3>
                            <span className="text-[10px] font-mono uppercase bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)] border border-[var(--md-sys-color-outline-variant)] px-2 py-0.5 rounded-full shrink-0">
                              Akte
                            </span>
                          </div>
                          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] italic truncate mt-0.5">
                            {activeDetailPlant.species}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic('subtle');
                          setSelectedPlant(null);
                        }}
                        className="text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] p-2 rounded-xl hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors cursor-pointer shrink-0"
                        aria-label="Pflanzen-Akte schließen (ESC)"
                        title="Schließen (ESC)"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Standort & Aktuelles Wetter Badge Bar */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--md-sys-color-on-surface)] bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] px-2.5 py-1 rounded-xl font-mono">
                        <MapPin className="w-3.5 h-3.5 text-[var(--md-sys-color-primary)] shrink-0" />
                        <span>{weather?.cityName ? `${cleanZip} ${weather.cityName}` : `PLZ ${cleanZip}`}</span>
                      </span>

                      {!weather || weather.loading ? (
                        <span className="w-20 h-6 bg-[var(--md-sys-color-surface-container-highest)] animate-pulse rounded-xl inline-block" />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] px-2.5 py-1 rounded-xl">
                          <CloudSun className="w-3.5 h-3.5 text-[var(--md-sys-color-primary)] shrink-0" />
                          <span>{temp.toFixed(1)}°C</span>
                        </span>
                      )}

                      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-xl font-medium ${dormancy.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dormancy.dotClass}`} />
                        <span>{dormancy.badgeLabel}</span>
                      </span>

                      {substrateRinseReminder && (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-xl font-medium text-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20">
                          <span>🚿 Substratspülung in {getSubstrateRinseDays(activeDetailPlant.createdAt, activeDetailPlant.id)} {getSubstrateRinseDays(activeDetailPlant.createdAt, activeDetailPlant.id) === 1 ? 'Tag' : 'Tagen'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Eingebettete Sub-Kachel: "Botanische Pflegesteckbrief-Garantie" (surface-container-lowest #FFFFFF) */}
              {(() => {
                const guarantee = getCareGuarantee(activeDetailPlant.species);
                const specs = getSpeciesDetails(activeDetailPlant.species);

                return (
                  <div className="bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--md-sys-color-on-surface)] tracking-wide uppercase">
                        Botanische Pflegesteckbrief-Garantie
                      </h4>
                    </div>

                    {/* Exakter Garantie-Text laut Vorgabe */}
                    <div className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-xl p-3">
                      <p className="text-xs text-[var(--md-sys-color-primary)] font-mono leading-relaxed select-all">
                        {guarantee.guaranteeText}
                      </p>
                    </div>

                    {/* Aufgeschlüsselte Übersicht */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-xl p-2.5">
                        <p className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-medium uppercase mb-0.5">Sonne</p>
                        <p className="text-[var(--md-sys-color-on-surface)] font-medium">{guarantee.sun}</p>
                      </div>
                      <div className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-xl p-2.5">
                        <p className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-medium uppercase mb-0.5">Wasser</p>
                        <p className="text-[var(--md-sys-color-on-surface)] font-medium">{guarantee.water}</p>
                      </div>
                      <div className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-xl p-2.5">
                        <p className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-medium uppercase mb-0.5">Substrat</p>
                        <p className="text-[var(--md-sys-color-on-surface)] font-medium">{guarantee.substrate}</p>
                      </div>
                    </div>

                    <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] leading-relaxed border-t border-[var(--md-sys-color-outline-variant)] pt-2.5">
                      <strong className="text-[var(--md-sys-color-on-surface)]">{specs.trapName}:</strong> {specs.trapDetail}
                    </p>
                  </div>
                );
              })()}

              {/* Eingebettete Sub-Kachel: "Verträgliche Nachbarn" (surface-container-lowest #FFFFFF) */}
              {(() => {
                const companion = getCompanionPlantGuide(activeDetailPlant.species);

                return (
                  <div className="bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0">
                          <Users className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-[var(--md-sys-color-on-surface)] tracking-wide uppercase">
                          Verträgliche Nachbarn
                        </h4>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]">
                        {companion.headline}
                      </span>
                    </div>

                    <div className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-xl p-3 space-y-2">
                      <p className="text-xs font-medium text-[var(--md-sys-color-primary)] leading-relaxed">
                        {companion.recommendation}
                      </p>
                      {companion.warningNote && (
                        <p className="text-[11px] text-[var(--md-sys-color-tertiary)] border-t border-[var(--md-sys-color-outline-variant)] pt-2 leading-snug flex items-start gap-1.5">
                          <span className="shrink-0 text-xs">⚠️</span>
                          <span>{companion.warningNote}</span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Eingebettete Sub-Kachel: "Gieß-Aktion & Anstau-Status" (surface-container-lowest #FFFFFF) */}
              {(() => {
                const watering = getWateringStatus(activeDetailPlant.lastWateredAt);

                return (
                  <div className="bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-[var(--md-sys-color-secondary-container)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0">
                          <Droplets className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-[var(--md-sys-color-on-surface)] tracking-wide uppercase">
                          Wasserstand & Anstau
                        </h4>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${watering.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${watering.dotClass}`} />
                        <span>{watering.label}</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleWaterPlant(activeDetailPlant.id)}
                      disabled={isWateringId === activeDetailPlant.id}
                      className="w-full py-2.5 bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-primary)] border border-[var(--md-sys-color-outline-variant)] font-semibold rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                    >
                      {isWateringId === activeDetailPlant.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Wird in Historie gespeichert...</span>
                        </>
                      ) : (
                        <>
                          <Droplets className="w-3.5 h-3.5" />
                          <span>Als heute gegossen erfassen (+ Historien-Eintrag)</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })()}

              {/* Eingebettete Sub-Kachel: "Historie" (surface-container-lowest #FFFFFF) */}
              {(() => {
                const rawWaterHistory = Array.isArray(activeDetailPlant.wateringHistory)
                  ? activeDetailPlant.wateringHistory
                  : activeDetailPlant.lastWateredAt
                  ? [activeDetailPlant.lastWateredAt]
                  : [];

                const combinedScans: PlantScanRecord[] = [
                  ...(Array.isArray(activeDetailPlant.scans) ? activeDetailPlant.scans : []),
                  ...(Array.isArray(activeDetailPlant.diagnosisHistory)
                    ? activeDetailPlant.diagnosisHistory.map((d) => ({
                        timestamp: d.diagnosedAt,
                        vitalityScore: d.score,
                        diagnosisSummary: d.summary,
                        immediateAction: '',
                      }))
                    : []),
                ];

                const sortedScans = [...combinedScans].sort((a, b) => {
                  const getMs = (t: any) =>
                    typeof t?.toMillis === 'function'
                      ? t.toMillis()
                      : typeof t?.seconds === 'number'
                      ? t.seconds * 1000
                      : typeof t === 'string'
                      ? new Date(t).getTime()
                      : 0;
                  return getMs(b.timestamp) - getMs(a.timestamp);
                });

                const hasHistory = rawWaterHistory.length > 0 || sortedScans.length > 0;

                return (
                  <div className="bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] rounded-2xl p-4 space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] flex items-center justify-center text-[var(--md-sys-color-primary)] shrink-0">
                          <History className="w-3.5 h-3.5" />
                        </div>
                        <h4 className="text-xs font-bold text-[var(--md-sys-color-on-surface)] tracking-wide uppercase">
                          Historie
                        </h4>
                      </div>
                      <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
                        {rawWaterHistory.length} Gieß-Einträge • {sortedScans.length} Diagnosen
                      </span>
                    </div>

                    {!hasHistory ? (
                      <div className="text-center py-5 bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] rounded-xl px-4">
                        <Clock className="w-6 h-6 text-[var(--md-sys-color-outline)] mx-auto mb-2" />
                        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] font-medium">
                          Noch keine Einträge in dieser Akte.
                        </p>
                        <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]/80 mt-1">
                          Erfasse oben den ersten Gießvorgang oder starte einen Scan mit Gemini Vision.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Gieß-Zeitpunkte */}
                        {rawWaterHistory.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-[var(--md-sys-color-primary)] mb-2 flex items-center gap-1.5">
                              <Droplets className="w-3 h-3" />
                              <span>Bisherige Gieß-Zeitpunkte ({rawWaterHistory.length})</span>
                            </p>
                            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                              {rawWaterHistory.map((ts, idx) => (
                                <div
                                  key={`water-${idx}`}
                                  className="flex items-center justify-between text-xs bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] px-3 py-2 rounded-xl"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] shrink-0" />
                                    <span className="text-[var(--md-sys-color-on-surface)] font-medium">
                                      {formatHistoryTimestamp(ts)}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
                                    Anstau aufgefüllt
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* KI-Diagnosen & Scans */}
                        {sortedScans.length > 0 && (
                          <div className={rawWaterHistory.length > 0 ? 'pt-3 border-t border-[var(--md-sys-color-outline-variant)]' : ''}>
                            <p className="text-[11px] font-semibold text-[var(--md-sys-color-primary)] mb-2 flex items-center gap-1.5">
                              <Sparkles className="w-3 h-3" />
                              <span>Zugewiesene KI-Diagnosen ({sortedScans.length})</span>
                            </p>
                            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                              {sortedScans.map((diag, idx) => (
                                <div
                                  key={`diag-${idx}`}
                                  className="bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] p-3 rounded-xl space-y-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-[var(--md-sys-color-on-surface)] font-medium">
                                      {formatHistoryTimestamp(diag.timestamp)}
                                    </span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 text-[var(--md-sys-color-on-primary-container)]">
                                      {diag.vitalityScore}% Vitalität
                                    </span>
                                  </div>
                                  <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
                                    {diag.diagnosisSummary}
                                  </p>
                                  {diag.immediateAction && (
                                    <div className="pt-1.5 border-t border-[var(--md-sys-color-outline-variant)] flex items-start gap-1.5 text-[11px] text-[var(--md-sys-color-primary)]">
                                      <CheckCircle2 className="w-3 h-3 text-[var(--md-sys-color-primary)] mt-0.5 shrink-0" />
                                      <span>{diag.immediateAction}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Bottom Actions Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-[var(--md-sys-color-outline-variant)] mt-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('warning');
                    const id = activeDetailPlant.id;
                    const name = activeDetailPlant.name;
                    setSelectedPlant(null);
                    handleDeletePlant(id, name);
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Pflanze entfernen</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('subtle');
                    setSelectedPlant(null);
                  }}
                  className="px-5 py-2.5 text-xs bg-[var(--md-sys-color-primary)] hover:bg-[#03593e] text-[var(--md-sys-color-on-primary)] font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <span>Akte schließen</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            AUTH MODAL (Sub-Step 7.3.1 - M3 Light Mode Login / Registrieren Modal)
           ======================================================== */}
        {isAuthModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => {
              triggerHaptic('subtle');
              setIsAuthModalOpen(false);
              setAuthError(null);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-modal-title"
              className="bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] rounded-[28px] p-6 max-w-sm w-full mx-auto relative animate-in zoom-in-95 duration-150 text-[var(--md-sys-color-on-surface)] backdrop-blur-md shadow-[0_4px_20px_-2px_rgba(2,67,46,0.06)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button X oben rechts */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('subtle');
                  setIsAuthModalOpen(false);
                  setAuthError(null);
                }}
                className="absolute top-5 right-5 p-1.5 text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] rounded-xl hover:bg-[var(--md-sys-color-surface-container-highest)] cursor-pointer transition-colors"
                title="Schließen"
                aria-label="Modal schließen"
              >
                <X className="w-4 h-4" />
              </button>

              {currentUser && !currentUser.isAnonymous && !showSwitchAccount ? (
                /* User-Profil Sheet für angemeldete Stamm-Nutzer */
                <div className="space-y-5">
                  {/* Header: "Dein Carnivora-Konto" */}
                  <div className="pr-6">
                    <h3 id="auth-modal-title" className="text-base font-bold text-[var(--md-sys-color-on-surface)] tracking-tight">
                      Dein Carnivora-Konto
                    </h3>
                    <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
                      Pflanzendaten &amp; Cloud-Synchronisation aktiv
                    </p>
                  </div>

                  {/* Profil-Karte (Sub-Kachel: surface-container-lowest #FFFFFF) */}
                  <div className="p-4 rounded-2xl bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)] space-y-3.5 text-center flex flex-col items-center">
                    {/* Avatar/Initialen-Circle */}
                    <div className="w-16 h-16 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)] border border-[#02432E]/20 flex items-center justify-center font-bold text-xl select-none">
                      {(() => {
                        const email = currentUser.email || '';
                        if (currentUser.displayName) {
                          const parts = currentUser.displayName.trim().split(' ');
                          if (parts.length >= 2) {
                            return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
                          }
                          return currentUser.displayName.slice(0, 2).toUpperCase();
                        }
                        return email.slice(0, 2).toUpperCase() || 'CC';
                      })()}
                    </div>

                    {/* E-Mail-Adresse des Nutzers */}
                    <div className="space-y-1 w-full">
                      <p className="font-bold text-sm text-[var(--md-sys-color-on-surface)] tracking-tight break-all">
                        {currentUser.email || 'Keine E-Mail hinterlegt'}
                      </p>
                      <p className="text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
                        Nutzer-ID: {currentUser.uid ? `${currentUser.uid.slice(0, 14)}...` : 'Synchronisiert'}
                      </p>
                    </div>

                    {/* Status-Badge: "✓ Gesichert (Synchronisation aktiv)" */}
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--md-sys-color-primary-container)] border border-[#02432E]/20 text-[var(--md-sys-color-on-primary-container)] text-xs font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--md-sys-color-primary)] shrink-0" />
                      <span>✓ Gesichert (Synchronisation aktiv)</span>
                    </div>
                  </div>

                  {/* Sicherheits- & Synchronisations-Hinweis */}
                  <div className="p-3 rounded-xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] text-[11px] text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
                    Deine Pflanzen-Akte, Gieß-Historien und KI-Scans sind dauerhaft mit diesem Konto verknüpft. Beim Abmelden wird eine frische, saubere Gast-Sitzung initialisiert.
                  </div>

                  {/* Logout Button & Kontowechsel */}
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={isAuthSubmitting}
                      className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold rounded-xl w-full py-3 transition-colors text-sm cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50"
                    >
                      {isAuthSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-red-700" />
                          <span>Abmeldung läuft...</span>
                        </>
                      ) : (
                        <span>Abmelden</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setShowSwitchAccount(true);
                        setAuthError(null);
                      }}
                      className="w-full py-2 text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] transition-colors cursor-pointer text-center"
                    >
                      Anderes Konto verwenden
                    </button>
                  </div>
                </div>
              ) : (
                /* Login / Registrieren Modal */
                <div className="space-y-4">
                  {/* Header Title */}
                  <div className="pr-6">
                    <h3 id="auth-modal-title" className="text-base font-bold text-[var(--md-sys-color-on-surface)] tracking-tight">
                      {authMode === 'login' ? 'Anmelden' : 'Konto erstellen'}
                    </h3>
                    <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
                      {authMode === 'login'
                        ? 'Melde dich an, um auf dein Moorbeet zuzugreifen.'
                        : 'Erstelle dein Profil für die Cloud-Synchronisation.'}
                    </p>
                  </div>

                  {/* Umschalter (Tabs) oben im Modal: "Anmelden" vs. "Konto erstellen" */}
                  <div className="grid grid-cols-2 p-1 bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] rounded-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setAuthMode('login');
                        setAuthError(null);
                      }}
                      className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                        authMode === 'login'
                          ? 'bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-primary)] border border-[var(--md-sys-color-outline-variant)]'
                          : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                      }`}
                    >
                      Anmelden
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setAuthMode('register');
                        setAuthError(null);
                      }}
                      className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                        authMode === 'register'
                          ? 'bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-primary)] border border-[var(--md-sys-color-outline-variant)]'
                          : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]'
                      }`}
                    >
                      Konto erstellen
                    </button>
                  </div>

                  {/* Error-Handling */}
                  {authError && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 leading-tight animate-in fade-in duration-150">
                      {authError}
                    </div>
                  )}

                  {/* E-Mail & Passwort Formular */}
                  <form onSubmit={handleEmailAuthSubmit} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] block">
                        E-Mail Adresse
                      </label>
                      <input
                        type="email"
                        value={authEmail}
                        onChange={(e) => {
                          setAuthEmail(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="name@beispiel.de"
                        required
                        className="bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] focus:border-[var(--md-sys-color-primary)] rounded-xl p-3 w-full text-sm outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--md-sys-color-on-surface)] block">
                        Passwort
                      </label>
                      <input
                        type="password"
                        value={authPassword}
                        onChange={(e) => {
                          setAuthPassword(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="••••••••"
                        required
                        className="bg-[var(--md-sys-color-surface-container-highest)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)] focus:border-[var(--md-sys-color-primary)] rounded-xl p-3 w-full text-sm outline-none transition-colors"
                      />
                    </div>

                    {/* Primär-Button (Submit) */}
                    <button
                      type="submit"
                      disabled={isAuthSubmitting}
                      className="bg-[var(--md-sys-color-primary)] hover:bg-[#03593e] text-[var(--md-sys-color-on-primary)] font-semibold rounded-xl w-full py-3 text-sm transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50"
                    >
                      {isAuthSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-[var(--md-sys-color-on-primary)]" />
                          <span>Anmeldung läuft...</span>
                        </>
                      ) : (
                        <span>{authMode === 'login' ? 'Anmelden' : 'Registrieren'}</span>
                      )}
                    </button>
                  </form>

                  {/* Trennlinie ("oder") */}
                  <div className="relative my-3 flex items-center justify-center">
                    <div className="border-t border-[var(--md-sys-color-outline-variant)] w-full" />
                    <span className="bg-[var(--md-sys-color-surface-container)] px-3 text-[11px] text-[var(--md-sys-color-on-surface-variant)] font-medium uppercase tracking-wider absolute">
                      oder
                    </span>
                  </div>

                  {/* Google Sign-In Button mit farbigem G-Logo */}
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isAuthSubmitting}
                    className="bg-[var(--md-sys-color-surface-container-lowest)] hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)] font-medium rounded-xl w-full py-3 flex items-center justify-center gap-2 text-sm transition-all cursor-pointer active:scale-[0.99] disabled:opacity-50"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                      />
                    </svg>
                    <span>Mit Google fortfahren</span>
                  </button>

                  {/* Zurück zum aktuellen Konto wenn showSwitchAccount aktiv war */}
                  {currentUser && !currentUser.isAnonymous && showSwitchAccount && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('subtle');
                        setShowSwitchAccount(false);
                        setAuthError(null);
                      }}
                      className="w-full text-center text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] py-1 transition-colors cursor-pointer"
                    >
                      ← Zurück zum aktuellen Konto
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
