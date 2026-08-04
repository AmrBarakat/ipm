Deno.serve(async () => Response.json(
  {
    build_id: 'podn-retired-2026-08-04',
    error: 'extractPODN is retired. Use extractPODNv2.',
    retired: true,
  },
  { status: 410 },
));