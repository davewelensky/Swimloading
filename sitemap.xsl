<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">
<xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>

<xsl:template match="/">
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>SwimLoading Sitemap</title>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg"/>
<style>
:root{
  --bg:#0a1628;--bg-card:#111c30;--border:rgba(255,255,255,0.06);
  --text:#f0f9ff;--text-sec:#94a3b8;--ocean:#38bdf8;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;}
.header{padding:24px 16px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,#0a1628,#091a2e);}
.header-inner{max-width:980px;margin:0 auto;display:flex;align-items:center;gap:14px;}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;font-size:19px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.brand img{height:24px;width:auto;}
h1{font-size:14px;color:var(--text-sec);margin-left:auto;font-weight:600;letter-spacing:0.03em;}
.container{max-width:980px;margin:0 auto;padding:24px 16px 48px;}
.summary{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:24px;font-size:14px;color:var(--text-sec);line-height:1.6;}
.summary strong{color:var(--text);font-weight:700;}
.summary code{font-family:'SF Mono',Menlo,Consolas,monospace;background:rgba(56,189,248,0.08);padding:1px 6px;border-radius:4px;color:var(--ocean);font-size:13px;}
table{width:100%;border-collapse:collapse;background:var(--bg-card);border-radius:12px;overflow:hidden;border:1px solid var(--border);}
thead{background:rgba(56,189,248,0.04);}
th{text-align:left;padding:12px 14px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-sec);border-bottom:1px solid var(--border);}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--border);}
td a{color:var(--ocean);text-decoration:none;}
td a:hover{text-decoration:underline;}
tr:last-child td{border-bottom:none;}
tr:hover td{background:rgba(56,189,248,0.03);}
.meta{font-size:11px;color:var(--text-sec);white-space:nowrap;}
.pri-1{color:#22c55e;font-weight:700;}
.pri-9, .pri-8{color:#38bdf8;font-weight:600;}
.pri-7, .pri-6{color:#cbd5e1;}
.pri-default{color:var(--text-sec);}
@media (max-width:640px){
  th:nth-child(3), td:nth-child(3),
  th:nth-child(4), td:nth-child(4){display:none;}
}
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <a class="brand" href="/"><img src="/icons/logo-wave.png" alt=""/>SwimLoading</a>
    <h1>Sitemap</h1>
  </div>
</div>
<div class="container">
  <div class="summary">
    This sitemap lists <strong><xsl:value-of select="count(s:urlset/s:url)"/> URLs</strong> on swimloading.com — the human-readable view of <code>/sitemap.xml</code>, used by search engines like Google and Bing to crawl the site.
  </div>
  <table>
    <thead>
      <tr>
        <th>URL</th>
        <th>Last modified</th>
        <th>Change freq</th>
        <th>Priority</th>
      </tr>
    </thead>
    <tbody>
      <xsl:for-each select="s:urlset/s:url">
        <xsl:sort select="s:priority" data-type="number" order="descending"/>
        <tr>
          <td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
          <td class="meta"><xsl:value-of select="s:lastmod"/></td>
          <td class="meta"><xsl:value-of select="s:changefreq"/></td>
          <td class="meta">
            <xsl:attribute name="class">
              meta pri-<xsl:value-of select="substring-before(s:priority,'.')"/>
            </xsl:attribute>
            <xsl:value-of select="s:priority"/>
          </td>
        </tr>
      </xsl:for-each>
    </tbody>
  </table>
</div>
</body>
</html>
</xsl:template>

</xsl:stylesheet>
