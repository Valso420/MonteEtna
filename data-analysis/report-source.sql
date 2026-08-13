CREATE VIEW headline_metrics AS
SELECT
  COUNT(*) AS tracks,
  ROUND(SUM(duration_ms) / 3600000.0, 1) AS totalHours,
  (SELECT COUNT(DISTINCT artist_key) FROM track_artists) AS uniqueArtists,
  AVG(is_available * 1.0) AS availableRate
FROM tracks;

CREATE VIEW monthly_additions AS
WITH RECURSIVE
bounds AS (
  SELECT
    date(MIN(substr(added_at, 1, 7)) || '-01') AS first_month,
    date(MAX(substr(added_at, 1, 7)) || '-01') AS last_month
  FROM tracks
),
months(month_start) AS (
  SELECT first_month FROM bounds
  UNION ALL
  SELECT date(month_start, '+1 month')
  FROM months, bounds
  WHERE month_start < last_month
),
month_counts AS (
  SELECT
    strftime('%Y-%m', months.month_start) AS month,
    COUNT(tracks.track_key) AS tracks
  FROM months
  LEFT JOIN tracks
    ON substr(tracks.added_at, 1, 7) = strftime('%Y-%m', months.month_start)
  GROUP BY months.month_start
)
SELECT
  month,
  tracks,
  CAST(substr(month, 1, 4) AS INTEGER) AS year,
  CAST(substr(month, 6, 2) AS INTEGER) AS monthNumber,
  SUM(tracks) OVER (ORDER BY month) AS cumulativeTracks
FROM month_counts
ORDER BY month;

CREATE VIEW top_artists AS
WITH artist_totals AS (
  SELECT
    artist_key,
    MIN(artist_name) AS artist,
    COUNT(DISTINCT track_key) AS tracks
  FROM track_artists
  GROUP BY artist_key
)
SELECT
  artist,
  tracks,
  tracks * 1.0 / (SELECT COUNT(*) FROM tracks) AS share,
  ROW_NUMBER() OVER (ORDER BY tracks DESC, artist ASC) AS rank
FROM artist_totals
ORDER BY tracks DESC, artist ASC;

CREATE VIEW release_mix AS
WITH labeled AS (
  SELECT
    CASE
      WHEN release_year < 2000 THEN 'Antes de 2000'
      WHEN release_year BETWEEN 2000 AND 2009 THEN '2000–2009'
      WHEN release_year BETWEEN 2010 AND 2019 THEN '2010–2019'
      WHEN release_year BETWEEN 2020 AND 2022 THEN '2020–2022'
      ELSE CAST(release_year AS TEXT)
    END AS bucket,
    CASE
      WHEN release_year < 2000 THEN 1
      WHEN release_year BETWEEN 2000 AND 2009 THEN 2
      WHEN release_year BETWEEN 2010 AND 2019 THEN 3
      WHEN release_year BETWEEN 2020 AND 2022 THEN 4
      ELSE release_year - 2018
    END AS bucket_order
  FROM tracks
  WHERE release_year IS NOT NULL
),
bucket_totals AS (
  SELECT bucket, bucket_order, COUNT(*) AS tracks
  FROM labeled
  GROUP BY bucket, bucket_order
)
SELECT
  bucket,
  bucket_order AS "order",
  tracks,
  tracks * 1.0 / (SELECT COUNT(*) FROM labeled) AS share
FROM bucket_totals
ORDER BY bucket_order;

CREATE VIEW duration_bands AS
WITH labeled AS (
  SELECT
    CASE
      WHEN duration_ms < 180000 THEN 'Menos de 3 min'
      WHEN duration_ms < 300000 THEN '3 a 5 min'
      WHEN duration_ms < 420000 THEN '5 a 7 min'
      WHEN duration_ms < 600000 THEN '7 a 10 min'
      ELSE '10 min o más'
    END AS band,
    CASE
      WHEN duration_ms < 180000 THEN 1
      WHEN duration_ms < 300000 THEN 2
      WHEN duration_ms < 420000 THEN 3
      WHEN duration_ms < 600000 THEN 4
      ELSE 5
    END AS band_order
  FROM tracks
),
band_totals AS (
  SELECT band, band_order, COUNT(*) AS tracks
  FROM labeled
  GROUP BY band, band_order
)
SELECT
  band,
  band_order AS "order",
  tracks,
  tracks * 1.0 / (SELECT COUNT(*) FROM tracks) AS share
FROM band_totals
ORDER BY band_order;

CREATE VIEW top_albums AS
SELECT
  album_name AS album,
  primary_artist AS primaryArtist,
  COUNT(*) AS tracks,
  MIN(release_date) AS releaseDate
FROM tracks
GROUP BY album_key, album_name, primary_artist
ORDER BY tracks DESC, album ASC;

CREATE VIEW quality_checks AS
WITH
track_stats AS (
  SELECT
    COUNT(*) AS row_count,
    COUNT(DISTINCT track_key) AS identity_count,
    COUNT(DISTINCT position) AS position_count,
    MIN(position) AS min_position,
    MAX(position) AS max_position,
    SUM(CASE WHEN is_available = 0 THEN 1 ELSE 0 END) AS unavailable_count,
    SUM(CASE WHEN popularity IS NULL THEN 1 ELSE 0 END) AS missing_popularity,
    SUM(CASE WHEN preview_url IS NULL OR preview_url = '' THEN 1 ELSE 0 END) AS missing_preview
  FROM tracks
),
summary_stats AS (
  SELECT
    COUNT(*) AS check_count,
    SUM(CASE WHEN expected_value = actual_value THEN 1 ELSE 0 END) AS pass_count
  FROM summary_values
),
candidate_stats AS (
  SELECT COUNT(*) AS candidate_groups
  FROM (
    SELECT a.normalized_name, a.artist_set_key
    FROM tracks AS a
    JOIN tracks AS b
      ON a.normalized_name = b.normalized_name
     AND a.artist_set_key = b.artist_set_key
     AND a.track_key < b.track_key
     AND ABS(a.duration_ms - b.duration_ms) <= 2000
    GROUP BY a.normalized_name, a.artist_set_key
  )
)
SELECT
  1 AS "order",
  'Identidad única por track' AS "check",
  CASE WHEN identity_count = row_count THEN 'OK' ELSE 'Revisar' END AS status,
  printf('%d identidades para %d filas', identity_count, row_count) AS evidence,
  CASE WHEN identity_count = row_count THEN 'Ninguna' ELSE 'Alta' END AS severity
FROM track_stats
UNION ALL
SELECT
  2,
  'Posiciones completas y sin repetir',
  CASE WHEN position_count = row_count AND min_position = 1 AND max_position = row_count THEN 'OK' ELSE 'Revisar' END,
  CASE
    WHEN position_count = row_count AND min_position = 1 AND max_position = row_count THEN printf('Secuencia 1–%d', row_count)
    ELSE printf('%d posiciones distintas', position_count)
  END,
  CASE WHEN position_count = row_count AND min_position = 1 AND max_position = row_count THEN 'Ninguna' ELSE 'Alta' END
FROM track_stats
UNION ALL
SELECT
  3,
  'Reconciliación con el resumen',
  CASE WHEN pass_count = check_count THEN 'OK' ELSE 'Revisar' END,
  printf('%d/%d controles coinciden', pass_count, check_count),
  CASE WHEN pass_count = check_count THEN 'Ninguna' ELSE 'Alta' END
FROM summary_stats
UNION ALL
SELECT
  4,
  'Disponibilidad en Spotify',
  CASE WHEN unavailable_count = 0 THEN 'OK' ELSE 'Con salvedad' END,
  printf('%d no disponibles (%.1f%%)', unavailable_count, unavailable_count * 100.0 / row_count),
  CASE WHEN unavailable_count = 0 THEN 'Ninguna' ELSE 'Media' END
FROM track_stats
UNION ALL
SELECT
  5,
  'Popularidad y previews',
  'No utilizable',
  printf('%.1f%% sin popularidad; %.1f%% sin preview', missing_popularity * 100.0 / row_count, missing_preview * 100.0 / row_count),
  'Media'
FROM track_stats
UNION ALL
SELECT
  6,
  'Candidatos por metadatos',
  CASE WHEN candidate_groups = 0 THEN 'OK' ELSE 'Revisión manual' END,
  printf('%d grupos con mismo título/artistas y duración ±2 s, pero IDs distintos', candidate_groups),
  CASE WHEN candidate_groups = 0 THEN 'Ninguna' ELSE 'Baja' END
FROM candidate_stats
ORDER BY "order";
