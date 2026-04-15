
import { useState, useEffect } from 'react';

export function useLoading(asyncFunction) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    asyncFunction()
      .then(result => {
        setData(result);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [asyncFunction]);

  return { loading, data, error };
}



// Пример использования в компоненте Login.jsx
// import { useLoading } from '../../hooks/useLoading';

// export default function Login() {
//   // Реальная загрузка данных с сервера
//   const { loading, data, error } = useLoading(async () => {
//     const response = await fetch('https://api.example.com/user');
//     return response.json();
//   });

//   if (loading) return <Preloader />;
//   if (error) return <div>Ошибка: {error.message}</div>;

//   return (
//     <div className="container-Login">
//       {/* контент с реальными данными {data} */}
//     </div>
//   );
// }