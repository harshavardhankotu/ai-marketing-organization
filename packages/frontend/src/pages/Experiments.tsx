import React from 'react';
import { 
  FlaskConical, 
  CheckCircle2, 
  XCircle, 
  TrendingUp, 
  AlertCircle, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface ExperimentsProps {
  experiments: any[];
}

export const Experiments: React.FC<ExperimentsProps> = ({ experiments }) => {
  const sampleExperiments = experiments.length > 0 ? experiments : [
    {
      id: 'exp_01',
      title: 'Transparent EMI Ad Copy vs Standard Free Checkup',
      hypothesis: 'Stating "Easy EMI from ₹2,999/mo" upfront generates +30% qualified patient leads in Hyderabad tech corridors.',
      baseline: 'Complimentary Dental Checkup in Banjara Hills',
      treatment: 'Custom Invisible Aligners with ₹2,999/mo Zero-Cost EMI',
      success_metric: 'Qualified Lead Conversion Rate',
      expected_effect: '+30% qualified consultation inquiries',
      status: 'CONCLUDED',
      outcome: 'SCALE',
      confidence_score: 0.98,
      decision_summary: 'Statistically significant uplift of +44.4% (p=0.021). Recommend scaling treatment permanently across campaigns.',
      metrics: {
        baselineSamples: 150,
        baselineConversions: 8,
        treatmentSamples: 150,
        treatmentConversions: 19,
        pVal: 0.021
      }
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-cyan-400" />
          Marketing Hypothesis & Split-Testing Lab
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Operated by Experiment Strategists & A/B Testing Agents. The system never declares success without mathematical significance.
        </p>
      </div>

      {/* Experiments Feed */}
      <div className="space-y-4">
        {sampleExperiments.map((exp: any) => (
          <div key={exp.id} className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">{exp.title}</h3>
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-400">
                  {exp.status}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">Outcome:</span>
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                  exp.outcome === 'SCALE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-300'
                }`}>
                  {exp.outcome || 'IN_PROGRESS'}
                </span>
              </div>
            </div>

            {/* Hypothesis Box */}
            <div className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 text-xs text-slate-300 space-y-1">
              <span className="text-slate-400 font-semibold block text-[11px]">Hypothesis:</span>
              <p className="font-medium text-slate-200">{exp.hypothesis}</p>
            </div>

            {/* Split Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-800">
                <span className="text-slate-500 text-[10px] uppercase font-bold block mb-1">Baseline Creative (Control)</span>
                <p className="text-slate-300 font-medium">{exp.baseline}</p>
                {exp.metrics && (
                  <div className="mt-3 flex items-center justify-between text-slate-400 text-[11px] pt-2 border-t border-slate-700/40">
                    <span>Samples: <strong className="text-slate-200">{exp.metrics.baselineSamples}</strong></span>
                    <span>Conversions: <strong className="text-slate-200">{exp.metrics.baselineConversions}</strong></span>
                    <span>CR: <strong className="text-slate-200">{((exp.metrics.baselineConversions / (exp.metrics.baselineSamples || 1)) * 100).toFixed(1)}%</strong></span>
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-lg bg-cyan-950/20 border border-cyan-500/30">
                <span className="text-cyan-400 text-[10px] uppercase font-bold block mb-1">Treatment Creative (Variation)</span>
                <p className="text-cyan-200 font-medium">{exp.treatment}</p>
                {exp.metrics && (
                  <div className="mt-3 flex items-center justify-between text-cyan-300 text-[11px] pt-2 border-t border-cyan-800/40">
                    <span>Samples: <strong>{exp.metrics.treatmentSamples}</strong></span>
                    <span>Conversions: <strong>{exp.metrics.treatmentConversions}</strong></span>
                    <span>CR: <strong className="text-emerald-400 font-bold">{((exp.metrics.treatmentConversions / (exp.metrics.treatmentSamples || 1)) * 100).toFixed(1)}%</strong></span>
                  </div>
                )}
              </div>
            </div>

            {/* Decision Summary */}
            {exp.decision_summary && (
              <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block text-emerald-200">Statistical Validation & Scale Decision:</span>
                  <p className="mt-0.5">{exp.decision_summary}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};