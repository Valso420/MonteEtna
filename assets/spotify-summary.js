(function () {
  var fallbackSummary = {
    playlistName: "Monte Etna",
    totalTracks: 2022,
    exportedTracks: 2022,
    totalHours: 157.8,
    averageDurationMin: 4.68,
    uniqueArtists: 1424,
    uniqueAlbums: 1761,
    topArtists: [
      { name: "Mathame", tracks: 65 },
      { name: "Anyma", tracks: 57 },
      { name: "Massano", tracks: 57 },
    ],
    lastUpdated: "2026-08-13T19:02:34.449Z",
  };

  function pick(summary, camelKey, snakeKey) {
    if (summary[camelKey] !== undefined) {
      return summary[camelKey];
    }

    return summary[snakeKey];
  }

  function normalizeSummary(summary) {
    var topArtists = pick(summary, "topArtists", "top_artists") || [];

    return {
      playlistName: pick(summary, "playlistName", "playlist_name") || fallbackSummary.playlistName,
      totalTracks: pick(summary, "totalTracks", "total_tracks") || fallbackSummary.totalTracks,
      exportedTracks:
        pick(summary, "exportedTracks", "exported_tracks") || fallbackSummary.exportedTracks,
      totalHours:
        pick(summary, "totalHours", "total_duration_hours") || fallbackSummary.totalHours,
      averageDurationMin:
        pick(summary, "averageDurationMin", "average_duration_min") ||
        fallbackSummary.averageDurationMin,
      uniqueArtists:
        pick(summary, "uniqueArtists", "unique_artists") || fallbackSummary.uniqueArtists,
      uniqueAlbums:
        pick(summary, "uniqueAlbums", "unique_albums") || fallbackSummary.uniqueAlbums,
      topArtists: topArtists.map(function (artist) {
        if (typeof artist === "string") {
          return { name: artist, tracks: null };
        }

        return {
          name: artist.name || artist.artist,
          tracks: artist.tracks || null,
        };
      }),
      lastUpdated: pick(summary, "lastUpdated", "exported_at") || fallbackSummary.lastUpdated,
    };
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("es-AR").format(value);
  }

  function formatDate(value) {
    if (!value) {
      return "datos sincronizados";
    }

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "datos sincronizados";
    }

    return "actualizada por última vez: " + date.toLocaleDateString("es-AR");
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function renderArtists(artists) {
    var element = document.getElementById("top-artists");
    if (!element || artists.length === 0) {
      return;
    }

    var topArtists = artists.slice(0, 3).filter(function (artist) {
      return artist.name;
    });

    if (topArtists.length === 0) {
      return;
    }

    element.textContent = "";

    topArtists.forEach(function (artist) {
      var item = document.createElement("span");
      item.className = "artist";
      item.textContent = artist.name;
      element.appendChild(item);
    });
  }

  function render(summary) {
    var totalHours = summary.totalHours.toLocaleString("es-AR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });

    setText("tracks-value", formatNumber(summary.totalTracks));
    setText("hours-value", totalHours);
    setText("artists-value", formatNumber(summary.uniqueArtists));
    setText("last-updated", formatDate(summary.lastUpdated));

    renderArtists(summary.topArtists);
  }

  fetch("data/spotify-playlist-summary.json", { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Summary not available");
      }

      return response.json();
    })
    .then(function (summary) {
      render(normalizeSummary(summary));
    })
    .catch(function () {
      render(fallbackSummary);
    });
})();
