// Stage 6G-A: fail closed, regardless of env flags or caller credentials.
// No DB reads, forecast downloads, subscriptions, encryption or HTTP delivery.
// Implement/approve dispatcher and job authentication separately before deployment.
Deno.serve(() => new Response(JSON.stringify({error:'PUSH_DELIVERY_NOT_IMPLEMENTED',deliveryEnabled:false}),{
 status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
}))
