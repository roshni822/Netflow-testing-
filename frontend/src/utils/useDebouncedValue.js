// Shared - useDebouncedValue.js
// Search boxes that drive a server query used to fire a request per keystroke,
// so typing "invoice" cost seven round trips and the results flickered as the
// out-of-order responses landed. Debounce the value that feeds the query.

import { useEffect, useState } from 'react'

export function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])

  return debounced
}
