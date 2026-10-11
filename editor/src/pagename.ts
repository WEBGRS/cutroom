// Shared by the CLI, the server and the page: what an HTML scene file is called
export const isHtml = (a: string) => /\.html?$/i.test(a);

// scenes/loop/index.html → loop, scenes/walk/walk.html → walk, scenes/loop/tall.html → loop/tall
export function pageName(src: string): string {
  // Also ../other-project/scenes/…, which tests and shared pages use
  const parts = src.replace(/^(.*\/)?scenes\//, '').replace(/\.html?$/i, '').split('/');
  if (parts.length === 2 && (parts[1].toLowerCase() === 'index' || parts[1] === parts[0])) return parts[0];
  return parts.join('/');
}
