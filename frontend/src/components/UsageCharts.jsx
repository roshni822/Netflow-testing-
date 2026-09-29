import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { useUsage } from '../lib/usageStore'
import { Link } from 'react-router-dom'

function formatSize(mb) {
  if (mb < 1) return Math.round(mb * 1024) + ' KB'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return Math.round(mb) + ' MB'
}

export default function UsageCharts() {
  const { usage, trend, loading } = useUsage()

  if (loading || !usage) return null

  // 1. Storage Data (Donut Chart)
  const storageMax = usage.resources?.storage?.max || 5120
  const storageUsed = usage.resources?.storage?.used || 0
  const storageAvailable = Math.max(0, storageMax - storageUsed)
  
  const storageData = [
    { name: 'Used', value: Math.round(storageUsed * 10) / 10 },
    { name: 'Available', value: Math.round(storageAvailable * 10) / 10 }
  ]
  const usedPercent = storageMax > 0 ? Math.round((storageUsed / storageMax) * 100) : 0
  const availPercent = 100 - usedPercent

  // 2. Submissions Time Series
  const submissionData = trend && trend.length > 0 ? trend : [
    { name: 'Sun', submissions: 0 }, { name: 'Mon', submissions: 0 }, { name: 'Tue', submissions: 0 }, 
    { name: 'Wed', submissions: 0 }, { name: 'Thu', submissions: 1 }, { name: 'Fri', submissions: 0 }, { name: 'Sat', submissions: 0 }
  ]

  // 3. Workflows vs Forms (Horizontal Bar Chart)
  const assetsData = [
    { name: 'Forms', count: usage.resources?.forms?.used || 0, fill: 'var(--color-primary)' }, // NetFlow primary
    { name: 'Workflows', count: usage.resources?.workflows?.used || 0, fill: '#10b981' }, // Emerald
    { name: 'Builders', count: usage.resources?.builders?.used || 0, fill: '#f59e0b' } // Amber
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Storage Donut Chart */}
      <div className="bg-white border border-line rounded-xl p-5 shadow-sm flex flex-col relative">
        <h3 className="text-sm font-bold text-fg mb-6">Storage Overview</h3>
        <div className="flex-1 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6 sm:gap-4">
          <div className="h-32 w-32 relative shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={storageData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={60}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  <Cell fill="var(--color-primary)" /> {/* NetFlow primary for Used */}
                  <Cell fill="#10b981" /> {/* Emerald for Available */}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-base font-black text-fg">{formatSize(storageUsed)}</span>
              <span className="text-[11px] text-fg-muted font-medium mt-0.5">Used</span>
            </div>
          </div>
          
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                <span className="text-fg font-medium text-xs">Used</span>
              </div>
              <div className="flex gap-3 text-xs text-right">
                <span className="font-bold text-fg w-12">{formatSize(storageUsed)}</span>
                <span className="text-fg-muted w-8">{usedPercent}%</span>
              </div>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-fg font-medium text-xs">Available</span>
              </div>
              <div className="flex gap-3 text-xs text-right">
                <span className="font-bold text-fg w-12">{formatSize(storageAvailable)}</span>
                <span className="text-fg-muted w-8">{availPercent}%</span>
              </div>
            </div>
            
            <div className="border-t border-line pt-3 flex items-center justify-between text-xs">
              <span className="font-bold text-fg">Total Storage</span>
              <span className="font-bold text-fg">{formatSize(storageMax)}</span>
            </div>
          </div>
        </div>
        <div className="mt-6">
          <Link to="/settings" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
            View storage details &rarr;
          </Link>
        </div>
      </div>

      {/* Submissions Line Chart */}
      <div className="bg-white border border-line rounded-xl p-5 shadow-sm flex flex-col relative">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-bold text-fg">Submissions (This Week)</h3>
          <select className="text-xs border border-line rounded px-2 py-1 text-fg-muted outline-none">
            <option>This Week</option>
            <option>Last Week</option>
          </select>
        </div>
        <div className="flex-1 min-h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={submissionData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
              <RechartsTooltip 
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px', padding: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
              />
              <Line type="monotone" dataKey="submissions" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4">
          <Link to="/forms" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
            View all submissions &rarr;
          </Link>
        </div>
      </div>

      {/* Assets Bar Chart */}
      <div className="bg-white border border-line rounded-xl p-5 shadow-sm flex flex-col relative">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-bold text-fg">Assets Created</h3>
          <select className="text-xs border border-line rounded px-2 py-1 text-fg-muted outline-none">
            <option>This Month</option>
            <option>All Time</option>
          </select>
        </div>
        <div className="flex-1 min-h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={assetsData} layout="vertical" margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#374151', fontWeight: 500 }} width={70} />
              <RechartsTooltip 
                cursor={{ fill: '#f9fafb' }} 
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px', padding: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4">
          <Link to="/workflows" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
            View all assets &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}
