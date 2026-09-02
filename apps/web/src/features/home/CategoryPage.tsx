import { Link } from 'react-router-dom';
import type { ActivityCategory } from '@aero/activity-engine';
import { activityRegistry } from '@/core/runtime';
import { categoryMeta } from '@/activities';
import { ActivityCard, Icon } from '@/ui';

export default function CategoryPage({ category }: { category: ActivityCategory }) {
  const meta = categoryMeta[category];
  const all = activityRegistry.byCategory(category);
  const available = all.filter((d) => d.status === 'available');
  const soon = all.filter((d) => d.status !== 'available');
  return (
    <div className="page">
      <div className="page-head enter">
        <div>
          <div className="eyebrow" style={{ color: meta.accent }}>
            {meta.label}
          </div>
          <h1>{meta.blurb}</h1>
        </div>
        {category === 'workout' && (
          <Link to="/workout/history" className="btn">
            <Icon.Flag size={18} /> History
          </Link>
        )}
      </div>
      <div className="card-grid enter enter-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {available.map((def) => (
          <ActivityCard key={def.id} def={def} to={`${meta.path}/${def.id}`} eyebrow="Play now" />
        ))}
        {soon.map((def) => (
          <ActivityCard key={def.id} def={def} />
        ))}
      </div>
      {available.length === 0 && <div className="empty">Nothing here yet.</div>}
    </div>
  );
}
