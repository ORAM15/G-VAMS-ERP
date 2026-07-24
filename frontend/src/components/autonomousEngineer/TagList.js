/**
 * A wrapped row of neutral pill tags (languages, frameworks, package managers, module names, file paths).
 */
function TagList({ items, emptyLabel = "None" }) {
  if (!items.length) {
    return <p className="text-sm text-zinc-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
          {item}
        </span>
      ))}
    </div>
  );
}

export default TagList;
