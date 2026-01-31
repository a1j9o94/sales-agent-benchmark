export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Handle /api/hello/:name
  if (pathParts.length > 2) {
    const name = pathParts[2];
    return Response.json({
      message: `Hello, ${name}!`,
    });
  }

  // Handle /api/hello
  return Response.json({
    message: "Hello, world!",
    method: req.method,
  });
}
