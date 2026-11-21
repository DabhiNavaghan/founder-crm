import OpenAI from 'openai';
import { verifyToken } from '@clerk/backend';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export default async function handler(req, res) {
 if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
 try {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({error:'Sign in required'});
  const claims = await verifyToken(auth.slice(7), {secretKey:process.env.CLERK_SECRET_KEY});
  if (!claims.sub) return res.status(401).json({error:'Invalid session'});
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({error:'AI is not configured yet. Add OPENAI_API_KEY in Vercel.'});
  const {contact,company,context,channel,profile}=req.body||{};
  if (!contact?.first_name || !company?.name || !context || !['LinkedIn','Email'].includes(channel)) return res.status(400).json({error:'Missing contact, company, research context or channel'});
  const prompt = `You write highly specific, human B2B outreach. The signed-in user's configurable profile is the sender identity. Never invent facts. Use only the supplied company/contact details and research context. Under 120 words. Address the contact by first name. Include one credible specific detail, a relevant benefit tied to the sender's services, and exactly one CTA for a 15-minute call (unless profile CTA specifies a different concise CTA). No generic openers, hype, or multiple pitches. Tone: confident, warm, natural. For Email include a concise subject; for LinkedIn omit subject. Return JSON with message, optional subject, score integer 1-10, improvement string. If context is weak, score below 7 and say more research is needed.`;
  const completion = await openai.chat.completions.create({model:'gpt-4.1-mini',response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({sender_profile:profile||{},contact:{first_name:contact.first_name,last_name:contact.last_name,role:contact.role,linkedin_headline:contact.linkedin_headline},company:{name:company.name,description:company.description,sector:company.sector,product_type:company.product_type},research_context:context,channel})}],temperature:0.6});
  const out=JSON.parse(completion.choices[0]?.message?.content||'{}');
  if(typeof out.message!=='string') throw new Error('The model returned an invalid draft');
  return res.status(200).json({message:out.message,subject:channel==='Email'?(out.subject||''):undefined,score:Math.max(1,Math.min(10,Number(out.score)||1)),improvement:out.improvement||''});
 } catch(e) { console.error('FounderFlow generation error',e); return res.status(401).json({error:e.message==='Invalid token'?'Session expired. Sign in again.':'Could not generate the message. Check your server configuration.'}); }
}
