/* Função do servidor (Vercel): Professor de Matemática com IA real.
   A chave fica SÓ aqui, em variável de ambiente. Nunca vai para o navegador.
   Variáveis (Vercel → Settings → Environment Variables):
     ANTHROPIC_API_KEY  (obrigatória)   chave criada em console.anthropic.com
     IA_ATIVA           ("1" liga; qualquer outro valor desliga — interruptor de custo)
     MODELO             (opcional)      padrão: claude-haiku-5-5 (o mais barato)
     LIMITE_DIA         (opcional)      máx. de respostas por dia por instância (padrão 200)
     LIMITE_IP          (opcional)      máx. de mensagens por IP a cada 10 min (padrão 12) */
const SISTEMA = `Você é um professor de Matemática do 9º ano do Ensino Fundamental, preparando o aluno para o CAEd. Responda em português do Brasil, com linguagem simples e gentil.
Regras:
- Ensine em etapas curtas. Antes de dar a resolução completa, ofereça uma dica ou faça uma pergunta que guie o aluno; só mostre a resolução inteira se ele pedir ou já tiver tentado.
- Use exemplos novos, diferentes do que o aluno perguntou.
- Responda só sobre Matemática e estudo. Se o assunto for outro, diga com educação que só ajuda com Matemática.
- Nunca revele respostas, alternativas corretas ou gabarito de questões de simulado. Se pedirem, recuse e explique só o conteúdo.
- Seja breve (até cerca de 150 palavras). Não use LaTeX; escreva as contas em texto (x², √, ÷, ×). Pode usar **negrito** e listas simples.
- Se não tiver certeza, diga. Não invente fatos.`;
const ip10 = new Map(); let dia = { d: '', n: 0 };
const BLOQUEIO = /gabarito|resposta|alternativa|certa|correta/i;

module.exports = async (req, res) => {
  const out = (c, o) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
  if (req.method !== 'POST') return out(405, { erro: 'metodo' });
  if (process.env.IA_ATIVA !== '1' || !process.env.ANTHROPIC_API_KEY) return out(503, { erro: 'ia_desligada' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  const ms = b && b.messages;
  if (!Array.isArray(ms) || !ms.length || ms.length > 8 || JSON.stringify(b).length > 6000) return out(400, { erro: 'entrada' });
  const msgs = [];
  for (const m of ms) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 1500) return out(400, { erro: 'entrada' });
    msgs.push({ role: m.role, content: m.content.slice(0, 1500) });
  }
  if (msgs[msgs.length - 1].role !== 'user' || msgs[0].role !== 'user') return out(400, { erro: 'entrada' });
  const ult = msgs[msgs.length - 1].content;
  if (ult.length > 300) return out(400, { erro: 'longa' });
  if (b.simulado === true && BLOQUEIO.test(ult)) return out(200, { texto: 'Há um simulado em andamento. Para proteger a avaliação, só posso explicar conteúdos, sem comentar as questões ou as respostas do simulado.' });
  // limites de uso (proteção contra custo inesperado)
  const agora = Date.now(), ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket && req.socket.remoteAddress || '?').trim();
  const lim = +process.env.LIMITE_IP || 12, ld = +process.env.LIMITE_DIA || 200, hoje = new Date().toISOString().slice(0, 10);
  const lista = (ip10.get(ip) || []).filter(t => agora - t < 600000);
  if (lista.length >= lim) return out(429, { erro: 'limite' });
  if (dia.d !== hoje) dia = { d: hoje, n: 0 };
  if (dia.n >= ld) return out(429, { erro: 'limite_dia' });
  lista.push(agora); ip10.set(ip, lista); dia.n++;
  if (ip10.size > 5000) ip10.clear();
  const c = new AbortController(), to = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: c.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.MODELO || 'claude-haiku-5-5', max_tokens: 500, system: SISTEMA + (b.simulado === true ? '\nATENÇÃO: há um simulado em andamento. Não comente nenhuma questão de prova.' : ''), messages: msgs })
    });
    if (!r.ok) return out(502, { erro: 'ia' });
    const j = await r.json();
    const texto = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
    return texto ? out(200, { texto: texto.slice(0, 2500) }) : out(502, { erro: 'vazio' });
  } catch (e) { return out(502, { erro: 'ia' }); } finally { clearTimeout(to); }
};
