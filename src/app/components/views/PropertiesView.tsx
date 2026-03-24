import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MapPin, Building2, CheckCircle2, Clock, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { MOCK_HOSTS } from '../../data/mock-data';
import type { Property } from '../../data/types';

export function PropertiesView() {
  const navigate = useNavigate();
  const { properties, onboardingData, formTemplate, addProperty, deleteProperty } = useAppContext();
  const [addingForHost, setAddingForHost] = useState<string | null>(null);
  const [newProp, setNewProp] = useState({ name: '', location: '', units: '1' });

  // Calculate form completion % for a property
  const getCompletion = (propId: string) => {
    const data = onboardingData[propId] || {};
    const filledKeys = Object.keys(data).filter(k => !k.startsWith('faqs__items') && data[k]?.trim());
    const totalRequired = formTemplate.reduce((acc, s) => acc + s.fields.filter(f => f.required).length, 0) || 1;
    return Math.min(100, Math.round((filledKeys.length / Math.max(totalRequired, 1)) * 100));
  };

  const handleAdd = (hostId: string) => {
    if (!newProp.name.trim()) return;
    const prop: Property = {
      id: `p${Math.random().toString(36).substring(7)}`,
      name: newProp.name.trim(),
      hostId,
      location: newProp.location.trim() || 'Unknown',
      units: Math.max(1, parseInt(newProp.units) || 1),
      status: 'Onboarding',
      portalToken: '',
      lastSyncedAt: new Date().toISOString(),
    };
    addProperty(prop);
    toast.success(`${prop.name} created`);
    setAddingForHost(null);
    setNewProp({ name: '', location: '', units: '1' });
  };

  // Group properties by host
  const byHost = MOCK_HOSTS.map(host => ({
    host,
    props: properties.filter(p => p.hostId === host.id),
  }));

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {byHost.map(({ host, props }) => (
          <div key={host.id}>
            {/* Host header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {host.name.charAt(0)}
              </div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{host.name}</span>
              <span className="text-[10px] text-slate-400">{props.length} {props.length === 1 ? 'property' : 'properties'}</span>
              <button
                onClick={() => { setAddingForHost(host.id); setNewProp({ name: '', location: '', units: '1' }); }}
                className="ml-auto px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                + Add
              </button>
            </div>

            {/* Inline add form */}
            {addingForHost === host.id && (
              <div className="mb-3 bg-white border border-indigo-200 rounded-xl p-4 flex gap-2 items-end">
                <div className="flex-1">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Property name *"
                    value={newProp.name}
                    onChange={e => setNewProp({ ...newProp, name: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && handleAdd(host.id)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500 mb-2"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Location"
                      value={newProp.location}
                      onChange={e => setNewProp({ ...newProp, location: e.target.value })}
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                    />
                    <input
                      type="number"
                      placeholder="Units"
                      min="1"
                      value={newProp.units}
                      onChange={e => setNewProp({ ...newProp, units: e.target.value })}
                      className="w-20 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleAdd(host.id)}
                    disabled={!newProp.name.trim()}
                    className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setAddingForHost(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Property cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {props.map(prop => {
                const completion = getCompletion(prop.id);
                const isActive = prop.status === 'Active';

                return (
                  <div
                    key={prop.id}
                    onClick={() => navigate(`/kb/${prop.id}`)}
                    className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all group relative cursor-pointer"
                  >
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${prop.name}? This cannot be undone.`)) {
                          deleteProperty(prop.id);
                          toast.success(`${prop.name} deleted`);
                        }
                      }}
                      className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete property"
                    >
                      <Trash2 size={14} />
                    </button>

                    {/* Card header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-inner shrink-0 bg-gradient-to-br from-indigo-500 to-indigo-600">
                        {prop.name.charAt(0)}
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {prop.status}
                      </span>
                    </div>

                    {/* Name + location */}
                    <h3 className="font-semibold text-sm text-slate-800 leading-tight mb-1 group-hover:text-indigo-700 transition-colors">
                      {prop.name}
                    </h3>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-3">
                      <MapPin size={9} />
                      <span className="truncate">{prop.location}</span>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Building2 size={9} />
                        {prop.units} {prop.units === 1 ? 'unit' : 'units'}
                      </span>
                      {prop.lastSyncedAt && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock size={9} />
                          Updated recently
                        </span>
                      )}
                    </div>

                    {/* Completion bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-slate-400 font-medium">Form completion</span>
                        <span className={`text-[9px] font-bold ${completion >= 80 ? 'text-green-600' : completion >= 50 ? 'text-amber-600' : 'text-slate-400'}`}>
                          {completion}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            completion >= 80 ? 'bg-gradient-to-r from-green-400 to-green-500'
                            : completion >= 50 ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                            : 'bg-gradient-to-r from-slate-300 to-slate-400'
                          }`}
                          style={{ width: `${completion}%` }}
                        />
                      </div>
                    </div>

                    {/* Active indicator */}
                    {isActive && completion >= 80 && (
                      <div className="mt-2 flex items-center gap-1 text-[9px] text-green-600">
                        <CheckCircle2 size={9} />
                        <span>AI-ready</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {properties.length === 0 && (
          <div className="text-center py-16">
            <Building2 size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-medium text-slate-400">No properties yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
