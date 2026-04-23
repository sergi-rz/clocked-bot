export default {
  dateLocale: 'en-US',

  opts: {
    period:  'Period',
    channel: 'Voice channel (optional, all channels by default)',
  },

  periods: {
    choices: [
      { name: 'Global (all time)', value: 'global' },
      { name: 'This year',         value: 'year'   },
      { name: 'This month',        value: 'month'  },
      { name: 'This week',         value: 'week'   },
      { name: 'Today',             value: 'today'  },
    ],
    labels: {
      global: 'Global',
      year:   'This year',
      month:  'This month',
      week:   'This week',
      today:  'Today',
    },
  },

  cmd: {
    ranking: {
      desc:   (a)      => `Top 10 by ${a} hours`,
      noData: (label)  => `No sessions recorded for "${label}".`,
      title:  (a, l)   => `${a} Ranking — ${l}`,
    },
    mystats: {
      desc:        (a)      => `Your ${a} statistics`,
      noData:                 'You have no recorded sessions yet.',
      optedOut:    (prefix) => `Tracking is disabled. Use \`/${prefix}-optout\` to re-enable it.`,
      title:       (a, u)   => `Your ${a} stats — ${u}`,
      fTotal:                 'Total time',
      fSessions:              'Sessions',
      fAvg:                   'Avg session',
      fLongest:               'Longest session',
      fStreak:                'Current streak',
      fBestStreak:            'Best streak',
      days:                   'days',
    },
    buddies: {
      desc:    (a)     => `Who you've spent the most time with in ${a}`,
      noData:  (label) => `You haven't coincided with anyone in "${label}" yet.`,
      title:   (a, l)  => `Your ${a} companions — ${l}`,
      together:          'together',
    },
    optout: {
      desc:     (a) => `Enable or disable tracking of your ${a} sessions`,
      disabled:       'Tracking has been **disabled**. Your entries will no longer be recorded. Historical data is kept.',
      enabled:        'Tracking has been **re-enabled**. Your sessions will be recorded again.',
    },
  },

  scheduler: {
    quiet:  (a)    => `Quiet week — no ${a} sessions recorded.`,
    title:  (a)    => `Weekly Summary — ${a}`,
    footer: (s, e) => `Week of ${s} to ${e}`,
  },

  errors: {
    cmd: 'Error executing command.',
  },
};
