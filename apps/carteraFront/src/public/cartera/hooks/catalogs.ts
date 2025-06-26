import { useEffect, useState } from "react";
import { getAdvisors, getInvestors } from "../services/services";
 

export const useCatalogs = () => {
  const [investors, setInvestors] = useState([]);
  const [advisors, setAdvisors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getInvestors(), getAdvisors()])
      .then(([inv, adv]) => {
        setInvestors(inv);
        setAdvisors(adv);
      })
      .finally(() => setLoading(false));
  }, []);

  return { investors, advisors, loading };
};
