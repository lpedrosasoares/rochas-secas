# 🪨 Rocha Seca

WebGIS simples para decidir se dá pra escalar no **Iperocks** (boulder em arenito, Iperó/SP) e na **Flona de Ipanema** (Morro Araçoiaba), perto de Sorocaba.

Mostra a chuva dos últimos 7, 14 ou 30 dias e a previsão dos próximos 3 dias, e dá um veredito por local: **Bora / Talvez / Melhor não / Não dá**.

## Funcionalidades

- **Mapa** (Leaflet) com os dois picos coloridos pelo veredito, camadas de mapa, satélite e relevo, e radar de chuva opcional (RainViewer).
- **Chuva por dia**: barras para os dois locais. Clique num dia para avaliar ir nele às 8h.
- **Chuva hora a hora**: clique ou arraste para escolher o momento avaliado. A faixa sombreada mostra as 72 h consideradas.
- **Atalhos** "Agora", "Amanhã 8h" e próximos dias, mais um slider de tempo.
- Tabela diária, tema claro e escuro, layout para celular.

## Como o veredito funciona

A partir do momento escolhido, o app soma a chuva das janelas 0–24 h, 24–48 h e 48–72 h, olha a previsão das 6 h seguintes e a umidade média das últimas 12 h. Os limites ficam em `evaluate()` no arquivo [`js/app.js`](js/app.js) e são fáceis de ajustar.

> Arenito molhado perde resistência e as agarras quebram. Na dúvida, não escale.

## Dados

- Chuva, umidade e previsão: [Open-Meteo](https://open-meteo.com/). É gratuito, não precisa de chave e é chamado direto do navegador. São dados de **modelo** com grade de cerca de 10 km, não de pluviômetro.
- Radar: [RainViewer](https://www.rainviewer.com/).
- Mapas base: OpenStreetMap, Esri World Imagery e OpenTopoMap.

As coordenadas ficam em `SITES`, no topo de `js/app.js`. A do Iperocks vem do Mountain Project. A da Flona é aproximada (Morro de Ipanema/Araçoiaba), então ajuste para o setor que você usa.

## Rodar localmente

É só HTML, CSS e JS estático, sem build:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Publicar no GitHub Pages

```bash
git init
git add .
git commit -m "Rocha Seca: chuva no Iperocks e na Flona"
git branch -M main
git remote add origin https://github.com/<seu-usuario>/rochaseca.git
git push -u origin main
```

Depois, no GitHub, vá em **Settings → Pages → Build and deployment → Deploy from a branch**, escolha `main` e `/ (root)`. O site fica em `https://<seu-usuario>.github.io/rochaseca/`.
