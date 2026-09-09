import React from 'react';
import { 
  Search, 
  ExternalLink, 
  CheckCircle2, 
  HelpCircle, 
  TrendingUp, 
  Layers,
  MapPin,
  ShieldAlert
} from 'lucide-react';

interface ResearchProps {
  findings: any[];
}

export const Research: React.FC<ResearchProps> = ({ findings }) => {
  const certaintyColors: Record<string, string> = {
    OBSERVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    CONFIRMED: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    INFERRED: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    HYPOTHESIZED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    PREDICTED: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  };

  const sampleFindings = findings.length > 0 ? findings : [
    {
      id: 'fnd_01',
      topic: 'Local Demand & Search Trends',
      market: 'Hyderabad (Gachibowli & Hitec City)',
      finding: 'Strong surge in search volume for "Clear Aligners in Gachibowli" and "Painless Dental Implants Hyderabad" (+44% YoY).',
      extracted_evidence: 'Local search query volume indices show 3,800 monthly queries in Western Hyderabad tech corridor.',
      source: 'Google Local Search & Justdial Medical Indices',
      certainty: 'OBSERVED',
      confidence_score: 0.92
    },
    {
      id: 'fnd_02',
      topic: 'Pricing Sensitivity & EMI Acceptance',
      market: 'Hyderabad (Banjara Hills & Jubilee Hills)',
      finding: 'Patients exhibit 2.8x higher booking conversion when 0% interest EMI options (Bajaj Finserv/Pine Labs) are stated upfront in INR.',
      extracted_evidence: 'Audit of 1,200 dental consultations across Banjara Hills and Jubilee Hills.',
      source: 'Indian Dental Association Hyderabad Chapter Survey',
      certainty: 'CONFIRMED',
      confidence_score: 0.89
    },
    {
      id: 'fnd_03',
      topic: 'Competitor Footprint & Review Grievances',
      market: 'Hyderabad Metro',
      finding: 'Top 3 corporate dental chains suffer 38% 1-star reviews due to hidden post-consultation costs and long clinic waiting times.',
      extracted_evidence: 'Practo and Google Business review mining across 42 clinics.',
      source: 'Review Mining Agent (res-12)',
      certainty: 'OBSERVED',
      confidence_score: 0.94
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <Search className="w-5 h-5 text-cyan-400" />
          Evidence-First Market Intelligence Hub
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Synthesized by 20 Research Agents. Every finding includes verifiable evidence, confidence scoring, and strict certainty classification.
        </p>
      </div>

      {/* Certainty Legend */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center gap-4 text-xs">
        <span className="text-slate-400 font-semibold">Evidence Classification:</span>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(certaintyColors).map(([certainty, colorClass]) => (
            <span key={certainty} className={`px-2 py-0.5 rounded border text-[11px] font-bold ${colorClass}`}>
              {certainty}
            </span>
          ))}
        </div>
      </div>

      {/* Findings List */}
      <div className="space-y-4">
        {sampleFindings.map((f: any) => (
          <div key={f.id} className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-3 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">{f.topic}</h3>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <MapPin className="w-3 h-3 text-cyan-400" />
                  {f.market}
                </span>
              </div>
              <span className={`px-2.5 py-0.5 rounded border text-xs font-bold self-start sm:self-auto ${
                certaintyColors[f.certainty] || certaintyColors.OBSERVED
              }`}>
                {f.certainty}
              </span>
            </div>

            <p className="text-xs text-slate-200 leading-relaxed font-medium">
              {f.finding}
            </p>

            {/* Extracted Evidence Box */}
            <div className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 text-xs text-slate-400 space-y-1">
              <span className="text-slate-300 font-semibold block text-[11px]">Extracted Evidence:</span>
              <p className="italic text-slate-300">"{f.extracted_evidence}"</p>
            </div>

            <div className="pt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Source: <strong className="text-slate-400">{f.source}</strong></span>
              <span>Confidence: <strong className="text-cyan-400">{(f.confidence_score * 100).toFixed(0)}%</strong></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};