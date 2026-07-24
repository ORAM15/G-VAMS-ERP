import ModuleCard from "./ModuleCard";

/**
 * Section 3 -- Engineering Knowledge. Reads only engineering-knowledge.json (Engineering Knowledge Engine
 * v1's output): one card per module it evaluated.
 */
function EngineeringKnowledgeSection({ knowledge }) {
  const modules = knowledge.modules || [];

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-white">Engineering Knowledge</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <ModuleCard key={module.name} module={module} />
        ))}
      </div>
    </section>
  );
}

export default EngineeringKnowledgeSection;
