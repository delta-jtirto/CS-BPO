import { useState } from 'react';
import {
  Clock, Plus, User, Wrench, Briefcase, Building,
  LayoutGrid, List, X, Trash2, Search
} from 'lucide-react';
import { toast } from 'sonner';
import { MOCK_HOSTS, MOCK_PROPERTIES } from '../../data/mock-data';
import { useAppContext } from '../../context/AppContext';
import { useIsMobile } from '../ui/use-mobile';
import type { Task } from '../../data/types';

export function TasksView() {
  const { activeHostFilter, tasks, addTask, updateTaskStatus, deleteTask } = useAppContext();
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHost, setNewHost] = useState('');
  const [newProp, setNewProp] = useState('');
  const [newVendor, setNewVendor] = useState('');
  const [newDue, setNewDue] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all');

  const filteredTasks = (activeHostFilter === 'all' ? tasks : tasks.filter(t => MOCK_HOSTS.find(h => h.id === activeHostFilter)?.name.includes(t.host.split(' ')[0])))
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => !taskSearch.trim() || t.title.toLowerCase().includes(taskSearch.toLowerCase()) || t.vendor.toLowerCase().includes(taskSearch.toLowerCase()) || t.prop.toLowerCase().includes(taskSearch.toLowerCase()));

  const columns = [
    { id: 'pending' as const, title: 'Pending Dispatch', color: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
    { id: 'dispatched' as const, title: 'Vendor Dispatched', color: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-500' },
    { id: 'resolved' as const, title: 'Resolved / Verify', color: 'bg-green-100 text-green-800 border-green-200', dot: 'bg-green-500' },
  ];

  const handleCreateTask = () => {
    if (!newTitle.trim() || !newHost) {
      toast.error('Task title and host are required');
      return;
    }
    const hostName = MOCK_HOSTS.find(h => h.id === newHost)?.name.split(' ')[0] || '';
    const propName = MOCK_PROPERTIES.find(p => p.id === newProp)?.name || '';
    addTask({
      title: newTitle.trim(),
      host: hostName,
      prop: propName,
      vendor: newVendor.trim() || 'Unassigned',
      status: 'pending',
      due: newDue || 'TBD',
    });
    setNewTitle(''); setNewHost(''); setNewProp(''); setNewVendor(''); setNewDue('');
    setShowNewTask(false);
    toast.success('Task created', { description: `"${newTitle.trim()}" added to Pending Dispatch` });
  };

  const handleDelete = (taskId: string, taskTitle: string) => {
    deleteTask(taskId);
    toast.success('Task deleted', { description: taskTitle });
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden animate-in fade-in duration-200">
      <div className="h-14 md:h-16 bg-white border-b border-slate-200 px-3 md:px-6 flex items-center justify-between shrink-0 shadow-sm">
        <h1 className={`${isMobile ? 'text-base' : 'text-xl'} font-bold flex items-center gap-2`}><Wrench size={isMobile ? 16 : 20} className="text-slate-500"/> {isMobile ? 'Dispatch' : 'BPO Dispatch Board'}</h1>
        <div className="flex gap-2 md:gap-4 items-center">
          {!isMobile && (
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button onClick={() => setViewMode('kanban')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}><LayoutGrid size={16}/></button>
              <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}><List size={16}/></button>
            </div>
          )}
          <button
            onClick={() => setShowNewTask(true)}
            className={`${isMobile ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-sm'} font-medium bg-slate-900 text-white rounded hover:bg-slate-800 flex items-center gap-1.5 shadow-sm transition-colors`}
          >
            <Plus size={14} /> {isMobile ? 'New' : 'New Task'}
          </button>
        </div>
      </div>

      {/* New Task Dialog */}
      {showNewTask && (
        <div className={`fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center ${isMobile ? 'p-3' : 'p-6'} backdrop-blur-sm animate-in fade-in`}>
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Plus size={18} /> Create New Task</h3>
              <button onClick={() => setShowNewTask(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Task Title <span className="text-red-500">*</span></label>
                <input type="text" placeholder="e.g., Fix water heater in Room 301" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full border border-slate-300 rounded-md text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none" />
              </div>
              <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Host Company <span className="text-red-500">*</span></label>
                  <select value={newHost} onChange={(e) => setNewHost(e.target.value)} className="w-full border border-slate-300 rounded-md text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                    <option value="">Select...</option>
                    {MOCK_HOSTS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Property</label>
                  <select value={newProp} onChange={(e) => setNewProp(e.target.value)} disabled={!newHost} className="w-full border border-slate-300 rounded-md text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50">
                    <option value="">Select...</option>
                    {MOCK_PROPERTIES.filter(p => !newHost || p.hostId === newHost).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Assign Vendor</label>
                  <input type="text" placeholder="Vendor name..." value={newVendor} onChange={(e) => setNewVendor(e.target.value)} className="w-full border border-slate-300 rounded-md text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Due</label>
                  <input type="text" placeholder="e.g., Today, 18:00" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="w-full border border-slate-300 rounded-md text-sm py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none" />
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewTask(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleCreateTask} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Create Task</button>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className={`${isMobile ? 'px-3 pt-3 flex-col' : 'px-6 pt-4 flex-row'} pb-0 flex gap-2 md:gap-3 shrink-0`}>
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-xs'}`}>
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            className="w-full border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
          />
        </div>
        <div className={`flex items-center gap-1.5 ${isMobile ? 'overflow-x-auto pb-1' : ''}`}>
          {[
            { id: 'all' as const, label: 'All', count: (activeHostFilter === 'all' ? tasks : tasks.filter(t => MOCK_HOSTS.find(h => h.id === activeHostFilter)?.name.includes(t.host.split(' ')[0]))).length },
            { id: 'pending' as const, label: 'Pending', count: (activeHostFilter === 'all' ? tasks : tasks.filter(t => MOCK_HOSTS.find(h => h.id === activeHostFilter)?.name.includes(t.host.split(' ')[0]))).filter(t => t.status === 'pending').length },
            { id: 'dispatched' as const, label: 'Dispatched', count: (activeHostFilter === 'all' ? tasks : tasks.filter(t => MOCK_HOSTS.find(h => h.id === activeHostFilter)?.name.includes(t.host.split(' ')[0]))).filter(t => t.status === 'dispatched').length },
            { id: 'resolved' as const, label: 'Resolved', count: (activeHostFilter === 'all' ? tasks : tasks.filter(t => MOCK_HOSTS.find(h => h.id === activeHostFilter)?.name.includes(t.host.split(' ')[0]))).filter(t => t.status === 'resolved').length },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors font-medium flex items-center gap-1.5 ${statusFilter === f.id ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              {f.label} <span className="text-[10px] opacity-60">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 ${isMobile ? 'p-3' : 'p-6'} overflow-hidden flex flex-col`}>
        {(isMobile || viewMode === 'kanban') ? (
          <div className={`flex gap-4 md:gap-6 h-full overflow-x-auto ${isMobile ? 'snap-x snap-mandatory pb-2' : 'min-w-max'}`}>
            {columns.map(col => (
              <div key={col.id} className={`${isMobile ? 'w-[280px] snap-center shrink-0' : 'w-80'} flex flex-col h-full`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`}></span>
                    {col.title}
                  </h3>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.color} border`}>
                    {filteredTasks.filter(t => t.status === col.id).length}
                  </span>
                </div>

                <div className="flex-1 bg-slate-200/50 rounded-xl p-3 flex flex-col gap-3 overflow-y-auto border border-slate-200 border-dashed">
                  {filteredTasks.filter(t => t.status === col.id).map(task => (
                    <div key={task.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{task.id}</span>
                        <div className="flex items-center gap-1">
                          <select
                            value={task.status}
                            onChange={(e) => {
                              updateTaskStatus(task.id, e.target.value as Task['status']);
                              toast.info(`Task moved to ${e.target.value}`);
                            }}
                            className={`text-[10px] font-bold px-2 py-1 rounded appearance-none cursor-pointer border outline-none ${
                              task.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              task.status === 'dispatched' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              'bg-green-50 text-green-700 border-green-200'
                            }`}
                          >
                            <option value="pending">Pending</option>
                            <option value="dispatched">Dispatched</option>
                            <option value="resolved">Resolved</option>
                          </select>
                          <button
                            onClick={() => handleDelete(task.id, task.title)}
                            className={`text-slate-300 hover:text-red-500 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all p-0.5`}
                            title="Delete task"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <h4 className="font-bold text-sm text-slate-800 mb-1 leading-tight">{task.title}</h4>
                      <div className="text-[10px] text-slate-500 space-y-1 mb-3">
                        <p className="flex items-center gap-1.5"><Briefcase size={10} className="text-slate-400"/> <strong>{task.host}</strong></p>
                        <p className="flex items-center gap-1.5"><Building size={10} className="text-slate-400"/> {task.prop}</p>
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 font-medium bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
                          <User size={10} className="text-slate-400"/> {task.vendor}
                        </div>
                        <span className="text-[10px] font-medium text-slate-500 flex items-center gap-1"><Clock size={10}/> {task.due}</span>
                      </div>
                    </div>
                  ))}
                  {filteredTasks.filter(t => t.status === col.id).length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-400 py-8">No tasks</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex-1">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-4">Status</th>
                  <th className="p-4">ID / Task</th>
                  <th className="p-4">Host Company</th>
                  <th className="p-4">Property</th>
                  <th className="p-4">Assigned Vendor</th>
                  <th className="p-4">Due</th>
                  <th className="p-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map(task => (
                  <tr key={task.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4">
                      <select
                        value={task.status}
                        onChange={(e) => {
                          updateTaskStatus(task.id, e.target.value as Task['status']);
                          toast.info(`Task moved to ${e.target.value}`);
                        }}
                        className={`text-[10px] font-bold px-2 py-1 rounded cursor-pointer border outline-none ${
                          task.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          task.status === 'dispatched' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          'bg-green-50 text-green-700 border-green-200'
                        }`}
                      >
                        <option value="pending">PENDING</option>
                        <option value="dispatched">DISPATCHED</option>
                        <option value="resolved">RESOLVED</option>
                      </select>
                    </td>
                    <td className="p-4">
                      <div className="text-[10px] text-slate-400 font-bold mb-0.5">{task.id}</div>
                      <div className="font-bold text-slate-800">{task.title}</div>
                    </td>
                    <td className="p-4 font-medium text-slate-700"><span className="flex items-center gap-2"><Briefcase size={12} className="text-slate-400"/> {task.host}</span></td>
                    <td className="p-4 text-slate-600">{task.prop}</td>
                    <td className="p-4"><span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs border border-slate-200">{task.vendor}</span></td>
                    <td className="p-4 text-slate-500 text-xs">{task.due}</td>
                    <td className="p-4">
                      <button
                        onClick={() => handleDelete(task.id, task.title)}
                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete task"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredTasks.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">No tasks found for this workspace filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}