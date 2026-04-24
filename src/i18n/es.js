export default {
  dateLocale: 'es-ES',

  opts: {
    period:  'Periodo',
    channel: 'Canal de voz (opcional, por defecto todos)',
  },

  periods: {
    choices: [
      { name: 'Global (todo el tiempo)', value: 'global' },
      { name: 'Este año',                value: 'year'   },
      { name: 'Este mes',                value: 'month'  },
      { name: 'Esta semana',             value: 'week'   },
      { name: 'Hoy',                     value: 'today'  },
    ],
    labels: {
      global: 'Global',
      year:   'Este año',
      month:  'Este mes',
      week:   'Esta semana',
      today:  'Hoy',
    },
  },

  cmd: {
    ranking: {
      desc:   (a)      => `Top 10 con más horas de ${a}`,
      noData: (label)  => `Sin sesiones registradas para "${label}".`,
      title:  (a, l)   => `Ranking ${a} — ${l}`,
    },
    mystats: {
      desc:        (a)      => `Tus estadísticas de ${a}`,
      noData:                 'Todavía no tienes sesiones registradas.',
      optedOut:    (prefix) => `Tienes el tracking desactivado. Usa \`/${prefix}-optout\` para reactivarlo.`,
      title:       (a, u)   => `Tus stats de ${a} — ${u}`,
      fTotal:                 'Total acumulado',
      fSessions:              'Sesiones',
      fAvg:                   'Media por sesión',
      fLongest:               'Sesión más larga',
      fStreak:                'Racha actual',
      fBestStreak:            'Mejor racha',
      days:                   'días',
    },
    buddies: {
      desc:    (a)     => `Con quién has coincidido más tiempo en ${a}`,
      noData:  (label) => `No has coincidido con nadie en "${label}" todavía.`,
      title:   (a, l)  => `Tus compañeros de ${a} — ${l}`,
      together:          'juntos',
    },
    optout: {
      desc:     (a) => `Activa o desactiva el tracking de tus sesiones de ${a}`,
      disabled:       'Tu tracking ha sido **desactivado**. Ya no se registrarán tus entradas al canal. Tus datos históricos se mantienen.',
      enabled:        'Tu tracking ha sido **reactivado**. Tus sesiones volverán a registrarse.',
    },
    setup: {
      desc:            'Configurar el bot en este servidor (solo admins)',
      subAdd:          'Añadir un canal de voz al tracking',
      subRemove:       'Quitar un canal de voz del tracking',
      subList:         'Ver la configuración actual',
      subConfig:       'Cambiar ajustes (idioma, zona horaria, etc.)',
      optChannel:      'Canal de voz',
      optActivityName: 'Nombre de la actividad (mostrado en embeds)',
      optLocale:       'Idioma',
      optTimezone:     'Zona horaria (ej: Europe/Madrid)',
      optSummaryHour:  'Hora del resumen semanal (0-23)',
      added:           (ch) => `Canal ${ch} añadido al tracking.`,
      missingPerms:    (ps) => `⚠️ Aviso: Clocked no tiene estos permisos en el canal: **${ps}**. El resumen semanal no podrá postearse ahí hasta que los concedas al rol Clocked en los ajustes del canal.`,
      alreadyAdded:    (ch) => `El canal ${ch} ya está en el tracking.`,
      removed:         (ch) => `Canal ${ch} eliminado del tracking.`,
      notTracked:      (ch) => `El canal ${ch} no estaba en el tracking.`,
      noneTracked:     (p)  => `Todavía no hay canales configurados. Usa \`/${p}-setup add\` para empezar.`,
      listTitle:             'Configuración',
      fChannels:             'Canales trackeados',
      fActivity:             'Nombre de actividad',
      fLocale:               'Idioma',
      fTimezone:             'Zona horaria',
      fSummaryHour:          'Hora del resumen semanal',
      configUpdated:         'Configuración actualizada.',
      noChanges:             'No hay cambios que aplicar.',
      invalidTimezone: (tz) => `Zona horaria no válida: ${tz}`,
      invalidHour:           'La hora debe estar entre 0 y 23.',
    },
  },

  scheduler: {
    quiet:  (a)    => `Semana tranquila — sin sesiones de ${a} registradas.`,
    title:  (a)    => `Resumen semanal — ${a}`,
    footer: (s, e) => `Semana del ${s} al ${e}`,
  },

  errors: {
    cmd: 'Error ejecutando el comando.',
  },
};
