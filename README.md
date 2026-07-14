# Monte Etna

Landing estática que conecta la
[playlist Monte Etna](https://open.spotify.com/playlist/3MKATRzfONdGDAbiQ7nioB)
con un grupo cerrado de WhatsApp.

Sitio público: [monteetna.vercel.app](https://monteetna.vercel.app/)

## Propósito

Monte Etna presenta una comunidad de música electrónica curada:

- la playlist es el sonido;
- el grupo es el acceso.

La página permite seguir la playlist, solicitar acceso al grupo o completar ambos
pasos dentro del mismo circuito.

## Estructura

- `index.html`: landing completa, sin build ni dependencias.
- `assets/playlist-cover.jpg`: portada local de la playlist.
- `assets/hero-volcanic-club.jpg`: imagen principal.
- `assets/spotify-summary.js`: fallback estático para el resumen visible.
- `assets/playlist-description.txt`: copia manual de la descripción pública de la
  playlist; no la consumen el sitio ni el workflow.
- `data/spotify-playlist-tracks.json`: export generado de canciones.
- `data/spotify-playlist-summary.json`: resumen generado y fuente primaria para
  las métricas de la landing.
- `data/spotify-playlist-tracks.csv`: export histórico; no lo actualiza el sync.
- `scripts/`: autenticación, sincronización y validación de Spotify.
- `.github/workflows/sync-spotify.yml`: actualización programada de los JSON.

## Datos de Spotify en la landing

El navegador intenta cargar `data/spotify-playlist-summary.json`. Si el fetch
falla —por ejemplo, al abrir el HTML directamente— utiliza
`assets/spotify-summary.js` como fallback.

El JSON generado es la fuente primaria y contiene la fecha de actualización,
cantidad de tracks, duración, artistas, álbumes, top de artistas y agregados
recientes. El README no copia esas métricas porque cambian con cada
sincronización.

El workflow actualiza únicamente los JSON bajo `data/`. No actualiza
`assets/spotify-summary.js`; cualquier cambio del fallback debe hacerse de forma
deliberada y contrastarse con el resumen generado. La landing no llama a Spotify
desde el navegador ni expone credenciales.

## Sincronización automática

GitHub Actions ejecuta `Sync Spotify playlist` cada seis horas y también admite
un disparo manual desde la interfaz de Actions. Si los JSON no cambian, el
workflow no crea un commit.

Credenciales sensibles requeridas:

- `SPOTIFY_CLIENT_ID`;
- `SPOTIFY_CLIENT_SECRET`;
- `SPOTIFY_REFRESH_TOKEN`.

`SPOTIFY_PLAYLIST_ID` identifica una playlist pública y no es secreto. El workflow
lo obtiene actualmente desde GitHub Actions secrets como configuración del
repositorio; `.env.example` mantiene el valor público por defecto. El redirect
URI loopback también es configuración no sensible.

## Obtener un refresh token

El helper abre el flujo local de autorización:

```powershell
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
$env:SPOTIFY_REDIRECT_URI="http://127.0.0.1:8888/callback"
node scripts/get-spotify-refresh-token.mjs
```

El comando imprime el refresh token una sola vez en la terminal. Esa salida es
un secreto: no debe copiarse a commits, documentación, logs, capturas ni mensajes.

## Sincronización local

Una sincronización real consulta Spotify y sobrescribe los dos JSON generados.
Después de confirmar las credenciales y el playlist de destino:

```powershell
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
$env:SPOTIFY_REFRESH_TOKEN="..."
$env:SPOTIFY_PLAYLIST_ID="3MKATRzfONdGDAbiQ7nioB"
node scripts/sync-spotify-playlist.mjs
node scripts/validate-spotify-data.mjs
```

El validador comprueba, entre otras cosas:

- que Spotify haya devuelto tracks;
- que el total exportado coincida con el informado por la API;
- que cada track tenga ID, nombre, duración y campo `addedBy`;
- que el resumen tenga duración, artistas, álbumes, top y recientes;
- que tracks disponibles y no disponibles sumen el total exportado.

Antes de conservar el resultado debe revisarse que solo hayan cambiado:

- `data/spotify-playlist-tracks.json`;
- `data/spotify-playlist-summary.json`.

Si Spotify responde `403 Forbidden`, comprueba que la cuenta autorizada sea owner
o colaboradora de la playlist y regenera el refresh token si corresponde.

## Desarrollo y validación

No hay instalación ni build. Abre `index.html` directamente o sirve la raíz con
un servidor estático. Revisa layout responsive, imágenes, enlaces y el fallback
de datos.

La validación offline de los datos versionados es:

```powershell
node scripts/validate-spotify-data.mjs
```
