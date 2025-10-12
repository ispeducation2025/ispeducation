import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

const ConceptPage = () => {
  const { subjectId, subtopicId, chapterId, conceptId } = useParams();
  const [concept, setConcept] = useState(null);

  useEffect(() => {
    const fetchConcept = async () => {
      const docRef = doc(
        db,
        "subjects",
        subjectId,
        "subtopics",
        subtopicId,
        "chapters",
        chapterId,
        "concepts",
        conceptId
      );
      const snapshot = await getDoc(docRef);
      if (snapshot.exists()) setConcept(snapshot.data());
    };
    fetchConcept();
  }, [subjectId, subtopicId, chapterId, conceptId]);

  if (!concept) return <p>Loading...</p>;

  return (
    <div style={{ padding: "20px" }}>
      <h2>{concept.name}</h2>
      {concept.videoUrl && (
        <div>
          <h3>Video</h3>
          <video src={concept.videoUrl} controls width="600" />
        </div>
      )}
      {concept.pptUrl && (
        <div>
          <h3>PPT</h3>
          <a href={concept.pptUrl} target="_blank" rel="noreferrer">
            Download PPT
          </a>
        </div>
      )}
      {concept.materialUrl && (
        <div>
          <h3>Study Material</h3>
          <a href={concept.materialUrl} target="_blank" rel="noreferrer">
            Download Material
          </a>
        </div>
      )}
      {concept.testId && (
        <div>
          <h3>Test</h3>
          <button>Start Test</button>
        </div>
      )}
    </div>
  );
};

export default ConceptPage;
