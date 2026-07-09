export async function onRequest(context) {
  const { request, next } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const response = await next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}