
import { useState, useEffect } from 'react';

export function useLoading(asyncFunction) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    asyncFunction()
      .then(result => {
        if (!isMounted) {
          return;
        }

        setData(result);
        setLoading(false);
      })
      .catch(err => {
        if (!isMounted) {
          return;
        }

        setError(err);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [asyncFunction]);

  return { loading, data, error };
}
