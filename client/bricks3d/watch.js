export const observesFocus = (target, scope, skip) => !!target?.closest && scope.contains(target) && !skip(target);
export const observesChange = (record, scope, watch, skip) =>
  observesFocus(record.target, scope, skip) && !!(record.type === 'childList' || record.target.closest(watch) || record.target === scope);
